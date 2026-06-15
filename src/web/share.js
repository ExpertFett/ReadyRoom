import { Router } from 'express';
import { getWingByIngestToken, getWing } from '../db/index.js';
import { getMissionRosterForShare } from '../db/missions.js';
import { getEventByMission, recordMissionResult, getEventSignups } from '../db/events.js';
import { editEvent as opsbotEditEvent } from '../services/opsbotBridge.js';
import { getBaseUrl } from '../config.js';

// Public, token-authenticated, CORS-enabled, READ-ONLY roster feed.
//
// Why this exists separately from /api: the dashboard API is session-auth
// (Discord OAuth, same-origin cookie). The DCS:OPT planner is a different
// origin and has no ReadyRoom session, so it can't call /api. This endpoint
// reuses the per-wing ingest_token (the same secret the Ops Bot already holds)
// as a bearer-in-path credential and emits CORS headers so a browser fetch from
// the planner succeeds. It is GET-only and exposes only the public-safe fields
// (name/callsign/modex/status) that already appear on Discord sign-up panels.
//
// Scope safety: the token resolves to exactly one wing, and we require the
// requested mission to belong to that wing — a token can never read another
// wing's missions. A wing/mission mismatch returns 404 (not 403) so the
// endpoint never confirms a foreign mission id exists.

function cors(req, res, next) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.set('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
}

export function shareRouter() {
  const router = Router();
  router.use(cors);

  // GET /:token — cheap reachability probe (mirrors the ingest "test
  // connection" endpoint). Confirms the token maps to a wing without
  // exposing any mission data.
  router.get('/:token', (req, res) => {
    const wing = getWingByIngestToken(req.params.token);
    if (!wing) return res.status(401).json({ error: 'bad_token' });
    res.json({ ok: true, wing: { id: wing.id, name: wing.name, tag: wing.tag || null } });
  });

  // GET /:token/missions/:missionId/roster — the readyroom.mission_roster.v1
  // contract consumed by the planner's "Import from Ready Room".
  router.get('/:token/missions/:missionId/roster', (req, res) => {
    const wing = getWingByIngestToken(req.params.token);
    if (!wing) return res.status(401).json({ error: 'bad_token' });

    const missionId = Number(req.params.missionId);
    const roster = Number.isFinite(missionId) ? getMissionRosterForShare(missionId) : null;
    // Unknown mission OR a mission belonging to another wing both 404 — never
    // leak the existence of a foreign wing's mission.
    if (!roster || roster.mission.wing_id !== wing.id) {
      return res.status(404).json({ error: 'mission_not_found' });
    }

    const m = roster.mission;
    res.json({
      schema: 'readyroom.mission_roster.v1',
      mission: {
        id: m.id,
        name: m.name,
        status: m.status,
        primary_aircraft: m.primary_aircraft || null,
        start_at: m.start_at || null,
      },
      wing: { id: wing.id, name: wing.name, tag: wing.tag || null },
      flights: roster.flights.map((f) => ({
        callsign: f.callsign || null,
        aircraft: f.aircraft || null,
        role: f.role || null,
        slots: f.slots,
        signups: f.signups.map((s) => ({
          name: s.name || null,
          callsign: s.callsign || null,
          modex: s.modex || null,
          status: s.status || null,
        })),
      })),
    });
  });

  // POST /:token/missions/:missionId/result — the planner pushes a post-mission
  // AAR back here (hop 7 of the OPT ⇄ RR loop). Tokened + CORS so the browser
  // planner can call it cross-origin, same as the GET roster above. Marks the
  // pilots who flew PRESENT on the linked event, stores the summary, and (if the
  // Ops Bot is wired) reflects the result on the Discord embed.
  router.post('/:token/missions/:missionId/result', (req, res) => {
    const wing = getWingByIngestToken(req.params.token);
    if (!wing) return res.status(401).json({ error: 'bad_token' });

    const missionId = Number(req.params.missionId);
    const roster = Number.isFinite(missionId) ? getMissionRosterForShare(missionId) : null;
    if (!roster || roster.mission.wing_id !== wing.id) {
      return res.status(404).json({ error: 'mission_not_found' });
    }
    const event = getEventByMission(missionId);
    if (!event) return res.status(409).json({ error: 'not_published' });

    const b = req.body || {};
    const participants = Array.isArray(b.participants) ? b.participants : [];
    const summary = typeof b.summary === 'string' ? b.summary.slice(0, 4000) : null;
    const { marked, unmatched } = recordMissionResult(event, participants, summary);

    // Reflect on the Discord embed if the wing's Ops Bot is wired (no-op otherwise).
    const w = getWing(wing.id);
    if (w?.ops_bot_url && w?.ops_bot_token && !w?.discord_paused && event.discord_message_id) {
      const resultLine = `✅ FLOWN — ${marked.length} present${summary ? `\n${summary}` : ''}`;
      opsbotEditEvent(w, event.discord_message_id, {
        readyroom_event_id: event.id,
        signup_callback_url: `${getBaseUrl()}/ingest/${req.params.token}`,
        title: event.title,
        description: (event.description ? event.description + '\n\n' : '') + resultLine,
        kind: event.kind, start_at: event.start_at,
        roles: event.roles, taskings: event.taskings,
        signups: getEventSignups(event.id),
        url: `${getBaseUrl()}/events/${event.id}`,
      });
    }

    res.json({ ok: true, present: marked.length, marked, unmatched });
  });

  return router;
}
