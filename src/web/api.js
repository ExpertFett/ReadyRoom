import { Router, raw } from 'express';
import db from '../db/index.js';
import { wingOf } from '../db/access.js';
import { logAction, getAuditLog, getAuditFilters } from '../db/audit.js';
import { seedDemoWing } from '../services/demoSeeder.js';
import {
  createWing, getWings, getWingsForUser, userHasWingAccess, getWing, updateWing, deleteWing,
  getWingIngestToken, regenerateWingIngestToken, setWingOpsBot, setWingDiscordPaused, getLastPublishedEvent,
  createSquadron, getSquadrons, getSquadron, updateSquadron, deleteSquadron,
  createMember, getMember, getMembersByWing, getMembersBySquadron, updateMember, deleteMember,
  addAlias, getAliases, getAlias, deleteAlias, relinkSortiesForAlias,
  createQual, getQuals, getQual, deleteQual, updateQual, bulkAssignQuals,
  getModexPools, setModexPool, deleteModexPool, getAvailableModex,
  getQualTracks, createQualTrack, deleteQualTrack,
  enrollPilot, unenrollPilot, getEnrollees,
  setMemberQual, getMemberQuals, removeMemberQual, memberHoldsQual,
  getRecentSorties, getMemberSorties, getUnmatchedAliases,
} from '../db/index.js';
import {
  createCampaign, getCampaigns, getCampaign, updateCampaign, deleteCampaign,
  createMission, listMissions, getMissionFull, updateMission, deleteMission, cloneMission,
  addFlight, getFlight, updateFlight, deleteFlight,
  signUp, getSignup, removeSignup,
  setMissionAccess,
  addResource, deleteResource,
  getDashboard,
} from '../db/missions.js';
import {
  setSquadronKind, setQualTier,
  getSquadronRoster, getSquadronReadiness,
  attachMember, detachMember, getDetachmentRoster,
} from '../db/roster.js';
import {
  createActivity, getActivities, getActivity, updateActivity, deleteActivity,
  signOffActivity, removeSignoff, bulkSignOff,
  getMemberActivitiesForQual, getMemberQualProgress,
  setQualCadence, getWingCurrency, getTrainingBoard,
} from '../db/quals.js';
import {
  createEvent, getEvent, updateEvent, deleteEvent, getEventsInRange,
  markAttendance, clearAttendance, getEventAttendance, getEventRoster,
  createLOA, getLOA, setLOAStatus, deleteLOA, getUpcomingLOAs, getMemberLOAs,
  getAttendanceMetrics, getAttendanceTimeseries, getPilotPerformance, setEventDiscord,
  setEventSignup, removeEventSignup, removeAllEventSignupsForUser, getEventSignups, countEventRoleSignups,
  claimEventSlot, getEventByMission,
} from '../db/events.js';
import { publishEvent as opsbotPublishEvent, editEvent as opsbotEditEvent, deleteEvent as opsbotDeleteEvent } from '../services/opsbotBridge.js';
import {
  createCarrier, getCarriers, getCarrier, updateCarrier, deleteCarrier,
  recordTrap, deleteTrap, getTrap,
  getTrapsByCarrier, getTrapsByMember, getTrapsByEvent,
  getMemberBoardingStats, getWingGreenieBoard, TRAP_GRADES,
} from '../db/carrier.js';
import {
  createTrainingSession, getTrainingSession, updateTrainingSession, deleteTrainingSession,
  getSessionsByPilot, getSessionsByInstructor, getTrainingSummary,
} from '../db/training.js';
import {
  createDocument, getDocument, updateDocument, deleteDocument, getDocumentsByWing,
  setDocumentFile, clearDocumentFile,
} from '../db/docs.js';
import { saveDocFile, readDocFile, deleteDocFile, MAX_DOC_FILE_BYTES } from '../services/fileStorage.js';
import { getBaseUrl } from '../config.js';
import { requireAuth, requireAdmin, getActor } from './auth.js';
import { parseMizSlots, flightsFromSlots } from '../services/mizParser.js';

const cleanId = (v) => (v ? String(v).replace(/[^0-9]/g, '') || null : null);
const str = (v, max = 2000) => (v == null ? null : String(v).slice(0, max));

// Minimal CSV parser (quoted fields ok). Rows keyed by lowercased header.
function parseCsv(text) {
  const lines = String(text).replace(/\r/g, '').split('\n').filter((l) => l.trim());
  if (!lines.length) return [];
  const parseLine = (line) => {
    const out = []; let cur = ''; let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c;
      } else if (c === '"') q = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };
  const headers = parseLine(lines[0]).map((h) => h.toLowerCase());
  return lines.slice(1).map((line) => {
    const vals = parseLine(line);
    const row = {};
    headers.forEach((h, j) => { row[h] = vals[j] ?? ''; });
    return row;
  });
}

export function apiRouter() {
  const router = Router();

  // Identity + bootstrap state for the SPA.
  router.get('/me', (req, res) => {
    if (!req.session?.user) return res.status(401).json({ error: 'unauthorized' });
    const actor = getActor(req);
    // setupNeeded is now per-user: root admins see it true when the system is
    // empty (so they can stand up a wing), regular users see it true when they
    // aren't a roster member of any wing (so they can't stumble into someone
    // else's data via the activeWing = wings[0] frontend default).
    const accessibleWings = actor.user
      ? (actor.root ? getWings() : getWingsForUser(actor.user.id))
      : [];
    res.json({
      user: actor.user,
      isAdmin: actor.isAdmin,
      role: actor.role,
      member: actor.member,
      setupNeeded: accessibleWings.length === 0,
    });
  });

  router.use(requireAuth);

  // SECURITY: wing access guard. Applied AFTER requireAuth so the user is known.
  // Resolves a wing_id from path/query/body and rejects (403) if the user isn't
  // a roster member of that wing — unless they're a root admin (config-level
  // override for the platform owner).
  //
  // Catches the common patterns:
  //   /wings/:id...              — path-based
  //   ?wing_id=N                 — query
  //   POST/PUT body with wing_id — body
  //
  // Nested resources keyed by their own ID (/members/:id, /squadrons/:id,
  // /quals/:id, /events/:id, /traps/:id, /documents/:id, /carriers/:id,
  // /missions/:id, /loas/:id, /training-sessions/:id) get individual checks
  // inside their handlers — see helpers below.
  router.use((req, res, next) => {
    const actor = getActor(req);
    if (actor.root) return next();
    if (!actor.user) return res.status(401).json({ error: 'auth_required' });
    const pathWing = req.path.match(/^\/wings\/(\d+)/);
    const wingId =
      (pathWing && Number(pathWing[1])) ||
      (req.query.wing_id && Number(req.query.wing_id)) ||
      (req.body && typeof req.body === 'object' && req.body.wing_id && Number(req.body.wing_id)) ||
      null;
    if (wingId == null) return next();
    if (!userHasWingAccess(actor.user.id, wingId)) {
      return res.status(403).json({ error: 'forbidden_wing' });
    }
    next();
  });

  // Helper used by nested-resource handlers to assert access.
  const assertWingAccess = (req, wingId) => {
    const actor = getActor(req);
    if (actor.root) return true;
    if (!actor.user) return false;
    return userHasWingAccess(actor.user.id, wingId);
  };

  // Shorthand for audit-log entries. Pulls actor from the request session
  // automatically. Never throws — best-effort logging.
  const audit = (req, wingId, action, entity_type, entity_id, summary, detail) => {
    logAction({
      wing_id: wingId, actor: getActor(req).user,
      action, entity_type, entity_id, summary, detail,
    });
  };

  // The wing's own ingest URL, sent to the Ops Bot in every publish so the bot
  // can auto-wire its sign-up click-back channel (no separate config needed).
  const signupCallback = (wing) => `${getBaseUrl()}/ingest/${getWingIngestToken(wing.id)}`;

  // Push the current event roster to the Ops Bot panel so site-originated
  // sign-up changes reflect on the Discord message. No-op if the event isn't
  // wired to a published panel. Fire-and-forget; never blocks the response.
  const pushSignupsToOpsBot = (eventId) => {
    const ev = getEvent(eventId);
    if (!ev || !ev.discord_message_id) return;
    const wing = getWing(ev.wing_id);
    if (!wing?.ops_bot_url || !wing?.ops_bot_token || wing.discord_paused) return;
    opsbotEditEvent(wing, ev.discord_message_id, {
      readyroom_event_id: ev.id,
      signup_callback_url: signupCallback(wing),
      title: ev.title, description: ev.description, kind: ev.kind,
      start_at: ev.start_at, roles: ev.roles, taskings: ev.taskings,
      signups: getEventSignups(ev.id),
      url: `${getBaseUrl()}/events/${ev.id}`,
    });
  };

  // Single-shot resource-wing access guard. Returns true if the response was
  // already terminated (404 or 403); the caller should bail. Returns false if
  // the request is OK to proceed.
  //
  //   if (denyResource(req, res, 'member', req.params.id)) return;
  const denyResource = (req, res, type, id) => {
    const wingId = wingOf(type, id);
    if (wingId == null) { res.status(404).json({ error: 'not_found' }); return true; }
    if (!assertWingAccess(req, wingId)) { res.status(403).json({ error: 'forbidden_wing' }); return true; }
    return false;
  };

  // SECURITY (resource-keyed): nested resources (/members/:id, /quals/:id,
  // /events/:id, etc.) carry their own ID in the URL, not a wing_id. The
  // wing-path middleware above only catches /wings/:id… patterns. This one
  // pattern-matches the rest and looks up each resource's wing_id via
  // wingOf(type, id), then enforces access the same way.
  //
  // Map of path prefix → resource type for wingOf(). The middleware below
  // walks this list, returns 404 if the resource doesn't exist (which is
  // also a safer signal than 403 for unknown IDs), or 403 on cross-wing.
  const RESOURCE_PATH_GUARDS = [
    [/^\/members\/(\d+)/,           'member'],
    [/^\/squadrons\/(\d+)/,         'squadron'],
    [/^\/aliases\/(\d+)/,           'alias'],
    [/^\/quals\/(\d+)/,             'qual'],
    [/^\/activities\/(\d+)/,        'activity'],
    [/^\/qual-tracks\/(\d+)/,       'qual_track'],
    [/^\/campaigns\/(\d+)/,         'campaign'],
    [/^\/missions\/(\d+)/,          'mission'],
    [/^\/flights\/(\d+)/,           'flight'],
    [/^\/resources\/(\d+)/,         'resource'],
    [/^\/signups\/(\d+)/,           'signup'],
    [/^\/events\/(\d+)/,            'event'],
    [/^\/loas\/(\d+)/,              'loa'],
    [/^\/training-sessions\/(\d+)/, 'training_session'],
    [/^\/documents\/(\d+)/,         'document'],
    [/^\/carriers\/(\d+)/,          'carrier'],
    [/^\/traps\/(\d+)/,             'trap'],
  ];
  router.use((req, res, next) => {
    const actor = getActor(req);
    if (actor.root) return next();
    for (const [re, type] of RESOURCE_PATH_GUARDS) {
      const m = req.path.match(re);
      if (m) {
        if (denyResource(req, res, type, m[1])) return;
        return next();
      }
    }
    next();
  });

  // A member is editable by an admin, or by the user it belongs to (self-service).
  const canEditMember = (req, member) => {
    const actor = getActor(req);
    if (actor.isAdmin) return true;
    return member && actor.user && member.discord_user_id === actor.user.id;
  };

  // ----- wings -----
  router.get('/wings', (req, res) => {
    const actor = getActor(req);
    // Root admins see everything; regular users see only wings where they
    // hold a roster slot (matched by Discord user ID).
    const wings = actor.root ? getWings() : getWingsForUser(actor.user?.id);
    res.json(wings.map((w) => ({ ...w, squadrons: getSquadrons(w.id).length })));
  });

  // Self-serve wing creation. A root admin can always create wings. Any other
  // authenticated user may stand up ONE wing IF they don't already belong to a
  // wing — and they become its first admin. Because members.discord_user_id is
  // globally unique, this naturally caps a non-root user at a single wing
  // without extra bookkeeping. This is what lets other squadrons onboard
  // themselves instead of waiting on the platform owner.
  router.post('/wings', (req, res) => {
    const actor = getActor(req);
    if (!actor.user) return res.status(401).json({ error: 'unauthorized' });
    if (!actor.root && actor.member) {
      // Already a member of a wing — can't spin up another.
      return res.status(403).json({ error: 'already_in_wing' });
    }
    const name = str(req.body?.name, 120);
    if (!name) return res.status(400).json({ error: 'missing_name' });
    const wing = createWing({
      name, tag: str(req.body?.tag, 32), description: str(req.body?.description, 2000),
      created_by: actor.user.id,   // owner — lets the switcher show them this wing
    });
    // Non-root creator becomes the wing's admin so they immediately have
    // access (the /api/wings list is membership-scoped). Root admins already
    // see every wing, so we don't force a member row on them.
    if (!actor.root && actor.user.id) {
      try {
        createMember(wing.id, {
          discord_user_id: actor.user.id,
          callsign: actor.user.username || 'CO',
          name: actor.user.username || null,
          app_role: 'admin', billet: 'CO', subdivision: 'main',
        });
      } catch (err) {
        console.warn('[create-wing] owner member link failed:', err.message);
      }
    }
    audit(req, wing.id, 'created', 'wing', wing.id, `Created wing "${wing.name}"`);
    res.json(wing);
  });

  router.get('/wings/:id', (req, res) => {
    const wing = getWing(Number(req.params.id));
    if (!wing) return res.status(404).json({ error: 'not_found' });
    res.json({ ...wing, squadrons: getSquadrons(wing.id) });
  });

  router.put('/wings/:id', requireAdmin, (req, res) => {
    const wing = getWing(Number(req.params.id));
    if (!wing) return res.status(404).json({ error: 'not_found' });
    const name = str(req.body?.name, 120) || wing.name;
    const updated = updateWing(wing.id, { name, tag: str(req.body?.tag, 32), description: str(req.body?.description, 2000) });
    audit(req, wing.id, 'updated', 'wing', wing.id, `Wing settings updated`);
    res.json(updated);
  });

  router.delete('/wings/:id', requireAdmin, (req, res) => {
    res.json({ ok: deleteWing(Number(req.params.id)) > 0 });
  });

  // DCS ingest token for a wing (used by the sortie hook / VectorBot mirror).
  router.get('/wings/:id/ingest', requireAdmin, (req, res) => {
    const wing = getWing(Number(req.params.id));
    if (!wing) return res.status(404).json({ error: 'not_found' });
    res.json({ ingest_url: `${getBaseUrl()}/ingest/${getWingIngestToken(wing.id)}` });
  });
  router.post('/wings/:id/ingest/regen', requireAdmin, (req, res) => {
    const wing = getWing(Number(req.params.id));
    if (!wing) return res.status(404).json({ error: 'not_found' });
    const url = `${getBaseUrl()}/ingest/${regenerateWingIngestToken(wing.id)}`;
    audit(req, wing.id, 'regenerated', 'ingest_token', wing.id, 'Sortie ingest token rotated');
    res.json({ ingest_url: url });
  });

  // Discord publish status panel data + pause toggle (Phase 4.4).
  router.get('/wings/:id/discord-status', (req, res) => {
    const wing = getWing(Number(req.params.id));
    if (!wing) return res.status(404).json({ error: 'not_found' });
    const wired = !!(wing.ops_bot_url && wing.ops_bot_token);
    res.json({
      wired,
      paused: !!wing.discord_paused,
      ops_bot_url: wing.ops_bot_url || null,
      last_published: getLastPublishedEvent(wing.id),
    });
  });
  router.put('/wings/:id/discord-paused', requireAdmin, (req, res) => {
    const wing = getWing(Number(req.params.id));
    if (!wing) return res.status(404).json({ error: 'not_found' });
    const paused = !!req.body?.paused;
    const updated = setWingDiscordPaused(wing.id, paused);
    audit(req, wing.id, paused ? 'paused' : 'resumed', 'ops_bot_config', wing.id,
      paused ? 'Discord publish paused' : 'Discord publish resumed');
    res.json(updated);
  });

  // Wing-level Ops Bot publish settings (Discord embed bridge — Epic 5b).
  router.put('/wings/:id/ops-bot', requireAdmin, (req, res) => {
    const wing = getWing(Number(req.params.id));
    if (!wing) return res.status(404).json({ error: 'not_found' });
    const updated = setWingOpsBot(wing.id, {
      ops_bot_url: str(req.body?.ops_bot_url, 500),
      ops_bot_token: str(req.body?.ops_bot_token, 200),
    });
    audit(req, wing.id, 'updated', 'ops_bot_config', wing.id,
      updated.ops_bot_url ? `Discord publish wired to ${updated.ops_bot_url}` : 'Discord publish unwired');
    res.json(updated);
  });

  // ----- squadrons -----
  router.get('/squadrons', (req, res) => {
    const wingId = Number(req.query.wing_id);
    if (!wingId) return res.status(400).json({ error: 'missing_wing_id' });
    res.json(getSquadrons(wingId));
  });

  router.post('/squadrons', requireAdmin, (req, res) => {
    const b = req.body || {};
    const wingId = Number(b.wing_id);
    if (!wingId || !getWing(wingId)) return res.status(400).json({ error: 'bad_wing' });
    if (!str(b.name, 120)) return res.status(400).json({ error: 'missing_name' });
    const created = createSquadron(wingId, {
      name: str(b.name, 120), tag: str(b.tag, 32), aircraft: str(b.aircraft, 120),
      description: str(b.description, 2000), sort_order: b.sort_order,
    });
    if (b.kind === 'detachment') setSquadronKind(created.id, 'detachment');
    audit(req, wingId, 'created', 'squadron', created.id, `Created squadron ${created.tag || created.name}`);
    res.json(getSquadron(created.id));
  });

  router.get('/squadrons/:id', (req, res) => {
    const sqn = getSquadron(Number(req.params.id));
    if (!sqn) return res.status(404).json({ error: 'not_found' });
    res.json({
      ...sqn,
      members: getMembersBySquadron(sqn.id),    // flat list (kept for compatibility)
      roster: getSquadronRoster(sqn.id),        // grouped by subdivision, with derived tier
      readiness: getSquadronReadiness(sqn.id),  // tier counts
      det_roster: sqn.kind === 'detachment' ? getDetachmentRoster(sqn.id) : null,
    });
  });

  router.put('/squadrons/:id', requireAdmin, (req, res) => {
    const sqn = getSquadron(Number(req.params.id));
    if (!sqn) return res.status(404).json({ error: 'not_found' });
    const b = req.body || {};
    const updated = updateSquadron(sqn.id, {
      name: str(b.name, 120) || sqn.name, tag: str(b.tag, 32), aircraft: str(b.aircraft, 120),
      description: str(b.description, 2000), sort_order: b.sort_order ?? sqn.sort_order,
    });
    audit(req, sqn.wing_id, 'updated', 'squadron', sqn.id, `Updated squadron ${updated.tag || updated.name}`);
    res.json(updated);
  });

  router.delete('/squadrons/:id', requireAdmin, (req, res) => {
    const sqn = getSquadron(Number(req.params.id));
    if (!sqn) return res.json({ ok: false });
    const ok = deleteSquadron(sqn.id) > 0;
    if (ok) audit(req, sqn.wing_id, 'deleted', 'squadron', sqn.id, `Deleted squadron ${sqn.tag || sqn.name}`);
    res.json({ ok });
  });

  // Import a roster from CSV. Headers (lowercased): callsign, name, rank, billet,
  // modex, airframes, subdivision, discord_user_id, notes, capabilities.
  // Pass ?dry=1 to preview without writing. Existing rows are MATCHED by:
  //   1. discord_user_id (if provided), then
  //   2. callsign + name (case-insensitive) on the same squadron.
  // Matched rows are UPDATED (fields blank in the CSV are left alone).
  router.post('/squadrons/:id/import-roster', requireAdmin, (req, res) => {
    const sqn = getSquadron(Number(req.params.id));
    if (!sqn) return res.status(404).json({ error: 'not_found' });
    const rows = parseCsv(req.body?.csv || '');
    if (!rows.length) return res.status(400).json({ error: 'empty_csv' });
    const dry = req.query.dry === '1' || req.body?.dry;
    const existing = getMembersBySquadron(sqn.id);
    const byDiscord = new Map(existing.filter((m) => m.discord_user_id).map((m) => [m.discord_user_id, m]));
    const byCallsignName = new Map(existing.map((m) => [`${(m.callsign || '').toLowerCase()}|${(m.name || '').toLowerCase()}`, m]));
    const summary = { created: 0, updated: 0, skipped: 0, preview: [] };
    for (const r of rows) {
      if (!r.callsign && !r.name) { summary.skipped++; continue; }
      const did = cleanId(r.discord_user_id || r.user_id);
      const key = `${(r.callsign || '').toLowerCase()}|${(r.name || '').toLowerCase()}`;
      const match = (did && byDiscord.get(did)) || byCallsignName.get(key) || null;
      const payload = {
        squadron_id: sqn.id,
        discord_user_id: did,
        callsign: r.callsign || (match?.callsign ?? null),
        name: r.name || (match?.name ?? null),
        rank: r.rank || (match?.rank ?? null),
        billet: r.billet || (match?.billet ?? null),
        airframes: r.airframes || (match?.airframes ?? sqn.aircraft ?? null),
        modex: r.modex || (match?.modex ?? null),
        subdivision: r.subdivision || (match?.subdivision ?? 'main'),
        notes: r.notes || (match?.notes ?? null),
        capabilities: r.capabilities || (match?.capabilities ?? null),
      };
      if (match) {
        if (!dry) updateMember(match.id, { ...match, ...payload });
        summary.updated++;
      } else {
        if (!dry) createMember(sqn.wing_id, payload);
        summary.created++;
      }
      if (summary.preview.length < 50) {
        summary.preview.push({
          action: match ? 'update' : 'create',
          callsign: payload.callsign, name: payload.name, modex: payload.modex,
          capabilities: payload.capabilities,
        });
      }
    }
    // Only log real writes, not dry-run previews.
    if (!dry && (summary.created || summary.updated)) {
      audit(req, sqn.wing_id, 'imported', 'roster', sqn.id,
        `CSV roster import to ${sqn.tag || sqn.name}: ${summary.created} created, ${summary.updated} updated`);
    }
    res.json({ ok: true, dry, total: rows.length, ...summary });
  });

  // ----- detachment cross-attachments -----
  router.post('/squadrons/:id/attach', requireAdmin, (req, res) => {
    const sqn = getSquadron(Number(req.params.id));
    if (!sqn) return res.status(404).json({ error: 'not_found' });
    const memberId = Number(req.body?.member_id);
    const m = getMember(memberId);
    if (!memberId || !m) return res.status(400).json({ error: 'bad_member' });
    attachMember(sqn.id, memberId, req.body?.attach_type, str(req.body?.note, 200));
    audit(req, sqn.wing_id, 'attached', 'detachment', memberId,
      `Attached ${m.callsign || m.name} to ${sqn.tag || sqn.name}`);
    res.json({ ok: true });
  });
  router.delete('/squadrons/:id/attach/:memberId', requireAdmin, (req, res) => {
    res.json({ ok: detachMember(Number(req.params.id), Number(req.params.memberId)) > 0 });
  });

  // ----- members -----
  router.get('/members', (req, res) => {
    const squadronId = Number(req.query.squadron_id);
    const wingId = Number(req.query.wing_id);
    // SECURITY: ?squadron_id= is neither a wing_id nor a /members/:id path, so
    // it slips past BOTH access middlewares above. Guard it explicitly via the
    // squadron's wing — otherwise a user in Wing A could list any Wing B
    // squadron's roster (names/callsigns/modex/ranks). The ?wing_id= branch is
    // already covered by the wing-path middleware.
    if (squadronId) {
      if (denyResource(req, res, 'squadron', squadronId)) return;
      return res.json(getMembersBySquadron(squadronId));
    }
    if (wingId) return res.json(getMembersByWing(wingId));
    res.status(400).json({ error: 'missing_filter' });
  });

  router.post('/members', requireAdmin, (req, res) => {
    const b = req.body || {};
    const wingId = Number(b.wing_id);
    if (!wingId || !getWing(wingId)) return res.status(400).json({ error: 'bad_wing' });
    try {
      const created = createMember(wingId, {
        squadron_id: b.squadron_id ? Number(b.squadron_id) : null,
        discord_user_id: cleanId(b.discord_user_id),
        callsign: str(b.callsign, 60), name: str(b.name, 120), rank: str(b.rank, 60),
        billet: str(b.billet, 60), airframes: str(b.airframes, 200),
        modex: str(b.modex, 12), subdivision: b.subdivision,
        status: b.status, app_role: b.app_role, notes: str(b.notes, 4000),
        joined_at: b.joined_at ? new Date(b.joined_at).getTime() : null,
        capabilities: b.capabilities,
      });
      audit(req, wingId, 'created', 'member', created.id,
        `Created ${created.callsign || created.name || '?'}${created.modex ? ` (${created.modex})` : ''}`);
      res.json(created);
    } catch (err) {
      res.status(400).json({ error: err.message === 'alias_taken' ? 'alias_taken' : 'create_failed' });
    }
  });

  router.get('/members/:id', (req, res) => {
    const member = getMember(Number(req.params.id));
    if (!member) return res.status(404).json({ error: 'not_found' });
    res.json({
      ...member,
      aliases: getAliases(member.id),
      quals: getMemberQuals(member.id).map((q) => ({ ...q, progress: getMemberQualProgress(member.id, q.qual_id) })),
      sorties: getMemberSorties(member.id, 50),
    });
  });

  router.put('/members/:id', (req, res) => {
    const member = getMember(Number(req.params.id));
    if (!member) return res.status(404).json({ error: 'not_found' });
    const actor = getActor(req);
    if (!canEditMember(req, member)) return res.status(403).json({ error: 'forbidden' });
    const b = req.body || {};
    // Admins edit the full record, but only fields PRESENT in the body are
    // changed — an omitted key keeps its existing value. This makes partial
    // PATCH-style updates safe (the dashboard sends the whole object, but API
    // consumers shouldn't have to, and a missing key shouldn't null the field).
    const has = (k) => Object.prototype.hasOwnProperty.call(b, k);
    const patch = actor.isAdmin
      ? {
          squadron_id: has('squadron_id') ? (b.squadron_id ? Number(b.squadron_id) : null) : member.squadron_id,
          discord_user_id: has('discord_user_id') ? cleanId(b.discord_user_id) : member.discord_user_id,
          callsign: has('callsign') ? str(b.callsign, 60) : member.callsign,
          name: has('name') ? str(b.name, 120) : member.name,
          rank: has('rank') ? str(b.rank, 60) : member.rank,
          billet: has('billet') ? str(b.billet, 60) : member.billet,
          airframes: has('airframes') ? str(b.airframes, 200) : member.airframes,
          modex: has('modex') ? str(b.modex, 12) : member.modex,
          subdivision: has('subdivision') ? b.subdivision : member.subdivision,
          status: has('status') ? b.status : member.status,
          app_role: has('app_role') ? b.app_role : member.app_role,
          notes: has('notes') ? str(b.notes, 4000) : member.notes,
          joined_at: has('joined_at') ? (b.joined_at ? new Date(b.joined_at).getTime() : null) : member.joined_at,
          capabilities: has('capabilities') ? b.capabilities : member.capabilities,
        }
      : {
          ...member,
          callsign: str(b.callsign, 60) ?? member.callsign,
          name: str(b.name, 120) ?? member.name,
          airframes: str(b.airframes, 200) ?? member.airframes,
        };
    const updated = updateMember(member.id, patch);
    audit(req, member.wing_id, 'updated', 'member', member.id,
      `Updated ${updated.callsign || updated.name || `#${member.id}`}`);
    res.json(updated);
  });

  router.delete('/members/:id', requireAdmin, (req, res) => {
    const member = getMember(Number(req.params.id));
    if (!member) return res.status(404).json({ error: 'not_found' });
    const ok = deleteMember(member.id) > 0;
    if (ok) audit(req, member.wing_id, 'deleted', 'member', member.id,
      `Deleted ${member.callsign || member.name || `#${member.id}`}`);
    res.json({ ok });
  });

  // ----- pilot aliases (identity bridge) -----
  router.post('/members/:id/aliases', (req, res) => {
    const member = getMember(Number(req.params.id));
    if (!member) return res.status(404).json({ error: 'not_found' });
    if (!canEditMember(req, member)) return res.status(403).json({ error: 'forbidden' });
    try {
      const alias = addAlias(member.id, req.body?.alias);
      const relinked = relinkSortiesForAlias(alias.alias, member.id);
      audit(req, member.wing_id, 'added', 'alias', member.id,
        `Added pilot alias "${alias.alias}" to ${member.callsign || member.name}${relinked ? ` (relinked ${relinked} sortie(s))` : ''}`);
      res.json({ ...alias, relinked });
    } catch (err) {
      const code = err.message === 'alias_taken' ? 409 : 400;
      res.status(code).json({ error: err.message || 'add_failed' });
    }
  });

  router.delete('/aliases/:aliasId', (req, res) => {
    const alias = getAlias(Number(req.params.aliasId));
    if (!alias) return res.status(404).json({ error: 'not_found' });
    const member = getMember(alias.member_id);
    if (!canEditMember(req, member)) return res.status(403).json({ error: 'forbidden' });
    const ok = deleteAlias(alias.id) > 0;
    if (ok && member) audit(req, member.wing_id, 'removed', 'alias', member.id,
      `Removed pilot alias "${alias.alias}" from ${member.callsign || member.name}`);
    res.json({ ok });
  });

  // ----- qualifications -----
  router.get('/quals', (req, res) => {
    const wingId = Number(req.query.wing_id);
    if (!wingId) return res.status(400).json({ error: 'missing_wing_id' });
    res.json(getQuals(wingId));
  });

  router.post('/quals', requireAdmin, (req, res) => {
    const b = req.body || {};
    const wingId = Number(b.wing_id);
    if (!wingId || !getWing(wingId)) return res.status(400).json({ error: 'bad_wing' });
    if (!str(b.code, 30) || !str(b.name, 120)) return res.status(400).json({ error: 'missing_fields' });
    try {
      const qual = createQual(wingId, {
        code: str(b.code, 30), name: str(b.name, 120), category: str(b.category, 60),
        description: str(b.description, 2000), sort_order: b.sort_order,
        is_basic: !!b.is_basic, is_currency: !!b.is_currency,
        is_wing_wide: b.is_wing_wide === undefined ? true : !!b.is_wing_wide,
        completion_deadline_days: b.completion_deadline_days,
      });
      if (b.is_tier) {
        setQualTier(qual.id, {
          is_tier: true,
          tier_order: Number(b.tier_order) || 0,
          tier_label: str(b.tier_label, 20) || qual.code,
        });
      }
      if (b.currency_days || b.completion_days) {
        setQualCadence(qual.id, {
          currency_days: Number(b.currency_days) || null,
          completion_days: Number(b.completion_days) || null,
        });
      }
      audit(req, wingId, 'created', 'qual', qual.id, `Created qual ${qual.code} (${qual.name})`);
      res.json({
        ...qual,
        is_tier: b.is_tier ? 1 : 0,
        tier_order: Number(b.tier_order) || 0,
        tier_label: b.is_tier ? (str(b.tier_label, 20) || qual.code) : null,
        currency_days: Number(b.currency_days) || null,
        completion_days: Number(b.completion_days) || null,
      });
    } catch (err) {
      res.status(400).json({ error: String(err.message).includes('UNIQUE') ? 'duplicate_code' : 'create_failed' });
    }
  });

  router.put('/quals/:id', requireAdmin, (req, res) => {
    const q = getQual(Number(req.params.id));
    if (!q) return res.status(404).json({ error: 'not_found' });
    const b = req.body || {};
    const updated = updateQual(q.id, {
      code: b.code !== undefined ? str(b.code, 30) : undefined,
      name: b.name !== undefined ? str(b.name, 120) : undefined,
      category: b.category !== undefined ? str(b.category, 60) : undefined,
      description: b.description !== undefined ? str(b.description, 2000) : undefined,
      sort_order: b.sort_order,
      is_basic: b.is_basic,
      is_currency: b.is_currency,
      is_wing_wide: b.is_wing_wide,
      completion_deadline_days: b.completion_deadline_days,
    });
    // Tier + cadence are stored separately by other helpers — apply them if present.
    if (b.is_tier !== undefined || b.tier_order !== undefined || b.tier_label !== undefined) {
      setQualTier(q.id, {
        is_tier: !!b.is_tier,
        tier_order: Number(b.tier_order) || 0,
        tier_label: str(b.tier_label, 20) || updated.code,
      });
    }
    if (b.currency_days !== undefined || b.completion_days !== undefined) {
      setQualCadence(q.id, {
        currency_days: b.currency_days !== undefined ? (Number(b.currency_days) || null) : undefined,
        completion_days: b.completion_days !== undefined ? (Number(b.completion_days) || null) : undefined,
      });
    }
    audit(req, q.wing_id, 'updated', 'qual', q.id, `Updated qual ${q.code}`);
    res.json(getQual(q.id));
  });

  router.delete('/quals/:id', requireAdmin, (req, res) => {
    const q = getQual(Number(req.params.id));
    if (!q) return res.status(404).json({ error: 'not_found' });
    const ok = deleteQual(q.id) > 0;
    if (ok) audit(req, q.wing_id, 'deleted', 'qual', q.id, `Deleted qual ${q.code}`);
    res.json({ ok });
  });

  // ----- Phase 2 bulk operations -----
  router.post('/wings/:id/quals/bulk-assign', requireAdmin, (req, res) => {
    const wing = getWing(Number(req.params.id));
    if (!wing) return res.status(404).json({ error: 'not_found' });
    const b = req.body || {};
    const qualIds = (Array.isArray(b.qual_ids) ? b.qual_ids : []).map(Number).filter(Boolean);
    const memberIds = (Array.isArray(b.member_ids) ? b.member_ids : []).map(Number).filter(Boolean);
    const mode = ['assign', 'unassign', 'instructor'].includes(b.mode) ? b.mode : 'assign';
    if (!qualIds.length || !memberIds.length) return res.status(400).json({ error: 'missing_ids' });
    const result = bulkAssignQuals(qualIds, memberIds, mode);
    audit(req, wing.id, `bulk-${mode}`, 'member_quals', null,
      `Bulk ${mode}: ${qualIds.length} qual(s) × ${memberIds.length} pilot(s) = ${result.changed} record(s)`,
      { qual_ids: qualIds, member_ids: memberIds });
    res.json(result);
  });

  router.post('/quals/:id/bulk-signoff', requireAdmin, (req, res) => {
    const q = getQual(Number(req.params.id));
    if (!q) return res.status(404).json({ error: 'not_found' });
    const b = req.body || {};
    const activityIds = (Array.isArray(b.activity_ids) ? b.activity_ids : []).map(Number).filter(Boolean);
    const memberIds = (Array.isArray(b.member_ids) ? b.member_ids : []).map(Number).filter(Boolean);
    const mode = ['signed', 'reset', 'instructor'].includes(b.mode) ? b.mode : 'signed';
    if (!activityIds.length || !memberIds.length) return res.status(400).json({ error: 'missing_ids' });
    const signerId = getActor(req).member?.id || null;
    const result = bulkSignOff(activityIds, memberIds, mode, signerId);
    audit(req, q.wing_id, `bulk-signoff-${mode}`, 'activity_signoffs', q.id,
      `${q.code} bulk sign-off (${mode}): ${activityIds.length} activit(y/ies) × ${memberIds.length} pilot(s) = ${result.changed} cell(s)`,
      { activity_ids: activityIds, member_ids: memberIds });
    res.json(result);
  });

  router.put('/members/:id/quals/:qualId', requireAdmin, (req, res) => {
    const member = getMember(Number(req.params.id));
    const qual = getQual(Number(req.params.qualId));
    if (!member || !qual) return res.status(404).json({ error: 'not_found' });
    const b = req.body || {};
    const result = setMemberQual(member.id, qual.id, {
      status: b.status,
      awarded_at: b.awarded_at ? new Date(b.awarded_at).getTime() : Date.now(),
      expires_at: b.expires_at ? new Date(b.expires_at).getTime() : null,
      notes: str(b.notes, 500),
    });
    audit(req, member.wing_id, 'set-qual', 'member_qual', member.id,
      `${member.callsign || member.name}: ${qual.code} → ${b.status || 'qualified'}`);
    res.json(result);
  });

  router.delete('/members/:id/quals/:qualId', requireAdmin, (req, res) => {
    const member = getMember(Number(req.params.id));
    const qual = getQual(Number(req.params.qualId));
    const ok = removeMemberQual(Number(req.params.id), Number(req.params.qualId)) > 0;
    if (ok && member && qual) audit(req, member.wing_id, 'removed-qual', 'member_qual', member.id,
      `Removed ${qual.code} from ${member.callsign || member.name}`);
    res.json({ ok });
  });

  // ===== Epic 2: qualification activities + sign-offs + currency =====
  router.get('/quals/:id/activities', (req, res) => {
    const qual = getQual(Number(req.params.id));
    if (!qual) return res.status(404).json({ error: 'not_found' });
    res.json(getActivities(qual.id));
  });
  router.post('/quals/:id/activities', requireAdmin, (req, res) => {
    const qual = getQual(Number(req.params.id));
    if (!qual) return res.status(404).json({ error: 'not_found' });
    const b = req.body || {};
    if (!str(b.name, 200)) return res.status(400).json({ error: 'missing_name' });
    const activity = createActivity(qual.id, {
      name: str(b.name, 200), group_name: str(b.group_name, 80),
      description: str(b.description, 2000),
      is_currency: !!b.is_currency, sort_order: b.sort_order,
    });
    audit(req, qual.wing_id, 'created', 'activity', activity.id, `Added activity "${activity.name}" to ${qual.code}`);
    res.json(activity);
  });
  router.put('/activities/:id', requireAdmin, (req, res) => {
    const a = getActivity(Number(req.params.id));
    if (!a) return res.status(404).json({ error: 'not_found' });
    const b = req.body || {};
    const updated = updateActivity(a.id, {
      name: str(b.name, 200) || a.name, group_name: str(b.group_name, 80),
      description: str(b.description, 2000),
      is_currency: !!b.is_currency, sort_order: b.sort_order ?? a.sort_order,
    });
    const wid = wingOf('activity', a.id);
    if (wid != null) audit(req, wid, 'updated', 'activity', a.id, `Updated activity "${updated.name}"`);
    res.json(updated);
  });
  router.delete('/activities/:id', requireAdmin, (req, res) => {
    const a = getActivity(Number(req.params.id));
    const wid = a ? wingOf('activity', a.id) : null;
    const ok = deleteActivity(Number(req.params.id)) > 0;
    if (ok && wid != null) audit(req, wid, 'deleted', 'activity', Number(req.params.id), `Deleted activity "${a.name}"`);
    res.json({ ok });
  });

  // sign-offs (admin/instructor): one per (member, activity)
  router.post('/members/:id/signoffs/:activityId', requireAdmin, (req, res) => {
    const m = getMember(Number(req.params.id));
    const a = getActivity(Number(req.params.activityId));
    if (!m || !a) return res.status(404).json({ error: 'not_found' });
    signOffActivity(m.id, a.id, {
      status: req.body?.status, signerId: getActor(req).member?.id,
      notes: str(req.body?.notes, 500),
    });
    res.json({ ok: true });
  });
  router.delete('/members/:id/signoffs/:activityId', requireAdmin, (req, res) => {
    res.json({ ok: removeSignoff(Number(req.params.id), Number(req.params.activityId)) > 0 });
  });

  // per-member per-qual activity list (powers the member detail expansion)
  router.get('/members/:id/quals/:qualId/activities', (req, res) => {
    const m = getMember(Number(req.params.id));
    const q = getQual(Number(req.params.qualId));
    if (!m || !q) return res.status(404).json({ error: 'not_found' });
    res.json(getMemberActivitiesForQual(m.id, q.id));
  });

  // training-board matrix: pilots × activities for one qual
  router.get('/quals/:id/board', (req, res) => {
    const board = getTrainingBoard(Number(req.params.id), { squadronId: Number(req.query.squadron_id) || null });
    if (!board) return res.status(404).json({ error: 'not_found' });
    res.json(board);
  });

  // currency status across a wing (for the currency panel)
  router.get('/wings/:id/currency', (req, res) => {
    const w = getWing(Number(req.params.id));
    if (!w) return res.status(404).json({ error: 'not_found' });
    res.json(getWingCurrency(w.id));
  });

  // ----- sortie activity -----
  router.get('/sorties', (req, res) => {
    const wingId = Number(req.query.wing_id);
    if (!wingId) return res.status(400).json({ error: 'missing_wing_id' });
    res.json(getRecentSorties(wingId, Math.min(200, Number(req.query.limit) || 50)));
  });

  // Aliases seen in sortie data that aren't mapped to any member yet (admin resolves these).
  router.get('/unmatched-aliases', requireAdmin, (req, res) => {
    const wingId = Number(req.query.wing_id);
    if (!wingId) return res.status(400).json({ error: 'missing_wing_id' });
    res.json(getUnmatchedAliases(wingId));
  });

  // =====================================================================
  // Missions / ops (Phase A) — the bot<->editor bridge object
  // =====================================================================
  const ms = (v) => {
    if (v == null || v === '') return null;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && /^\d+$/.test(v)) return Number(v);
    const t = new Date(v).getTime();
    return Number.isFinite(t) ? t : null;
  };

  // ----- campaigns -----
  router.get('/campaigns', (req, res) => {
    const wingId = Number(req.query.wing_id);
    if (!wingId) return res.status(400).json({ error: 'missing_wing_id' });
    res.json(getCampaigns(wingId));
  });
  router.post('/campaigns', requireAdmin, (req, res) => {
    const b = req.body || {};
    const wingId = Number(b.wing_id);
    if (!wingId || !getWing(wingId)) return res.status(400).json({ error: 'bad_wing' });
    if (!str(b.name, 160)) return res.status(400).json({ error: 'missing_name' });
    res.json(createCampaign(wingId, { name: str(b.name, 160), description: str(b.description, 4000), status: b.status, start_at: ms(b.start_at), end_at: ms(b.end_at) }));
  });
  router.put('/campaigns/:id', requireAdmin, (req, res) => {
    const c = getCampaign(Number(req.params.id));
    if (!c) return res.status(404).json({ error: 'not_found' });
    const b = req.body || {};
    res.json(updateCampaign(c.id, { name: str(b.name, 160) || c.name, description: str(b.description, 4000), status: b.status, start_at: ms(b.start_at), end_at: ms(b.end_at) }));
  });
  router.delete('/campaigns/:id', requireAdmin, (req, res) => res.json({ ok: deleteCampaign(Number(req.params.id)) > 0 }));

  // ----- missions -----
  router.get('/missions', (req, res) => {
    const wingId = Number(req.query.wing_id);
    if (!wingId) return res.status(400).json({ error: 'missing_wing_id' });
    res.json(listMissions(wingId, {
      status: req.query.status, type: req.query.type,
      campaign_id: req.query.campaign_id, aircraft: req.query.aircraft, search: req.query.search,
    }));
  });
  router.post('/missions', requireAdmin, (req, res) => {
    const b = req.body || {};
    const wingId = Number(b.wing_id);
    if (!wingId || !getWing(wingId)) return res.status(400).json({ error: 'bad_wing' });
    if (!str(b.name, 160)) return res.status(400).json({ error: 'missing_name' });
    res.json(createMission(wingId, {
      type: b.type, campaign_id: b.campaign_id, name: str(b.name, 160),
      primary_aircraft: str(b.primary_aircraft, 120), status: b.status,
      start_at: ms(b.start_at), duration_min: Number(b.duration_min) || null,
      description: str(b.description, 8000), miz_ref: str(b.miz_ref, 500),
    }, getActor(req).user?.id || null));
  });
  router.get('/missions/:id', (req, res) => {
    const m = getMissionFull(Number(req.params.id));
    if (!m) return res.status(404).json({ error: 'not_found' });
    res.json(m);
  });
  // Mint the public, tokened sign-up link an admin pastes into the DCS:OPT
  // planner's "Import from Ready Room". Reuses the wing's ingest_token as the
  // path credential (see src/web/share.js). Wing access is enforced by the
  // /missions/:id resource guard above; requireAdmin gates minting. The link is
  // wing-confidential — rotating the wing's ingest token invalidates it.
  router.get('/missions/:id/share-link', requireAdmin, (req, res) => {
    const m = getMissionFull(Number(req.params.id));
    if (!m) return res.status(404).json({ error: 'not_found' });
    const token = getWingIngestToken(m.wing_id);
    res.json({ url: `${getBaseUrl()}/share/${token}/missions/${m.id}/roster` });
  });

  // Publish (or re-sync) a mission as a sign-up event — the OPT ⇄ RR loop
  // keystone. Generates one signup slot per flight seat (group = flight
  // callsign, label "<callsign> 1-<seat>" to match the planner's voice-callsign
  // convention), links the event back to the mission, and fans it out to the
  // Ops Bot like POST /api/events. Once published, the mission's share link
  // (consumed by the planner) sources its roster from this event's signups —
  // so Discord sign-ups flow straight through to OPT.
  router.post('/missions/:id/publish-event', requireAdmin, (req, res) => {
    const m = getMissionFull(Number(req.params.id));
    if (!m) return res.status(404).json({ error: 'not_found' });

    const roles = [];
    const taskings = {};
    m.flights.forEach((f, idx) => {
      const group = f.callsign || `Flight ${idx + 1}`;
      if (f.role) taskings[group] = f.role;
      const seats = Math.max(1, Number(f.slots) || 1);
      for (let seat = 1; seat <= seats; seat++) {
        roles.push({ label: `${group} 1-${seat}`, group, limit: 1 });
      }
    });

    const existing = getEventByMission(m.id);
    let event;
    if (existing) {
      // Re-sync roles/taskings from the (possibly edited) flights while
      // preserving the event's own title/description/schedule. Signups on
      // unchanged seat labels survive.
      event = updateEvent(existing.id, {
        squadron_id: existing.squadron_id, title: existing.title, description: existing.description,
        kind: existing.kind, start_at: existing.start_at, end_at: existing.end_at,
        multi_squadron: !!existing.multi_squadron, track_attendance: existing.track_attendance !== 0,
        roles, taskings,
      });
    } else {
      event = createEvent(m.wing_id, {
        title: m.name,
        description: m.description || `Sign-up for ${m.name}.`,
        kind: 'squadron',
        start_at: m.start_at || Date.now(),
        roles, taskings, mission_id: m.id,
      }, getActor(req).user?.id || null);
    }

    // Fire-and-forget Discord publish/edit if the wing's Ops Bot is wired.
    const wing = getWing(m.wing_id);
    if (wing?.ops_bot_url && wing?.ops_bot_token && !wing?.discord_paused) {
      const panel = {
        readyroom_event_id: event.id, signup_callback_url: signupCallback(wing),
        title: event.title, description: event.description, kind: event.kind,
        start_at: event.start_at, roles: event.roles, taskings: event.taskings,
        url: `${getBaseUrl()}/events/${event.id}`,
      };
      if (existing?.discord_message_id) {
        opsbotEditEvent(wing, existing.discord_message_id, panel);
      } else {
        opsbotPublishEvent(wing, panel).then((r) => { if (r) setEventDiscord(event.id, r.channel_id, r.message_id); });
      }
    }

    audit(req, m.wing_id, existing ? 'updated' : 'created', 'event', event.id, `Published mission as event: ${event.title}`);
    res.json(event);
  });
  router.put('/missions/:id', requireAdmin, (req, res) => {
    const m = getMissionFull(Number(req.params.id));
    if (!m) return res.status(404).json({ error: 'not_found' });
    const b = req.body || {};
    res.json(updateMission(m.id, {
      type: b.type ?? m.type, campaign_id: b.campaign_id ?? m.campaign_id, name: str(b.name, 160) || m.name,
      primary_aircraft: str(b.primary_aircraft, 120), status: b.status ?? m.status,
      start_at: ms(b.start_at), duration_min: Number(b.duration_min) || null,
      description: str(b.description, 8000), miz_ref: str(b.miz_ref, 500),
    }));
  });
  router.delete('/missions/:id', requireAdmin, (req, res) => res.json({ ok: deleteMission(Number(req.params.id)) > 0 }));
  router.post('/missions/:id/clone', requireAdmin, (req, res) => {
    const m = getMissionFull(Number(req.params.id));
    if (!m) return res.status(404).json({ error: 'not_found' });
    const b = req.body || {};
    res.json(cloneMission(m.id, { wingId: m.wing_id, type: b.type || 'standalone', name: str(b.name, 160) }, getActor(req).user?.id || null));
  });

  // ----- flights -----
  router.post('/missions/:id/flights', requireAdmin, (req, res) => {
    const m = getMissionFull(Number(req.params.id));
    if (!m) return res.status(404).json({ error: 'not_found' });
    res.json(addFlight(m.id, req.body || {}));
  });
  router.put('/flights/:id', requireAdmin, (req, res) => {
    const f = getFlight(Number(req.params.id));
    if (!f) return res.status(404).json({ error: 'not_found' });
    res.json(updateFlight(f.id, req.body || {}));
  });
  router.delete('/flights/:id', requireAdmin, (req, res) => res.json({ ok: deleteFlight(Number(req.params.id)) > 0 }));

  // Import flights from a .miz upload (raw binary). Pass ?replace=1 to wipe existing flights first.
  router.post('/missions/:id/import-miz', requireAdmin, raw({ type: '*/*', limit: '20mb' }), (req, res) => {
    const mission = getMissionFull(Number(req.params.id));
    if (!mission) return res.status(404).json({ error: 'not_found' });
    if (!req.body || !req.body.length) return res.status(400).json({ error: 'empty_body' });
    let slots;
    try {
      slots = parseMizSlots(req.body);
    } catch (err) {
      return res.status(400).json({ error: err.message || 'parse_failed' });
    }
    const flights = flightsFromSlots(slots);
    const replace = req.query.replace === '1';
    if (replace) for (const f of mission.flights) deleteFlight(f.id);
    let order = replace ? 0 : (mission.flights.length || 0);
    const created = flights.map((f) => addFlight(mission.id, {
      sort_order: order++,
      callsign: f.callsign,
      aircraft: f.aircraft,
      role: null,
      slots: f.slots,
      squadron_id: null,
      notes: f.country ? `from .miz · ${f.side}/${f.country}` : 'from .miz',
    }));
    res.json({
      ok: true,
      parsed_slots: slots.length,
      flights_created: created.length,
      mission: getMissionFull(mission.id),
    });
  });

  // ----- squadron access & resources -----
  router.post('/missions/:id/access', requireAdmin, (req, res) => {
    const m = getMissionFull(Number(req.params.id));
    if (!m) return res.status(404).json({ error: 'not_found' });
    res.json(setMissionAccess(m.id, req.body?.access || []));
  });
  router.post('/missions/:id/resources', requireAdmin, (req, res) => {
    const m = getMissionFull(Number(req.params.id));
    if (!m) return res.status(404).json({ error: 'not_found' });
    const b = req.body || {};
    res.json(addResource(m.id, { kind: b.kind, label: str(b.label, 200), url: str(b.url, 1000) }));
  });
  router.delete('/resources/:id', requireAdmin, (req, res) => res.json({ ok: deleteResource(Number(req.params.id)) > 0 }));

  // ----- signups (self-service, or admin signing on behalf) -----
  router.post('/flights/:id/signup', (req, res) => {
    const flight = getFlight(Number(req.params.id));
    if (!flight) return res.status(404).json({ error: 'not_found' });
    const actor = getActor(req);
    let memberId = Number(req.body?.member_id) || null;
    if (memberId && !actor.isAdmin) return res.status(403).json({ error: 'forbidden' });
    if (!memberId) memberId = actor.member?.id || null;
    if (!memberId) return res.status(400).json({ error: 'no_member' });
    try {
      res.json(signUp(flight.id, memberId, req.body?.status));
    } catch (err) {
      const code = ['flight_full', 'already_signed'].includes(err.message) ? 409 : 400;
      res.status(code).json({ error: err.message || 'signup_failed' });
    }
  });
  router.delete('/signups/:id', (req, res) => {
    const s = getSignup(Number(req.params.id));
    if (!s) return res.status(404).json({ error: 'not_found' });
    const actor = getActor(req);
    if (!actor.isAdmin && s.member_id !== actor.member?.id) return res.status(403).json({ error: 'forbidden' });
    res.json({ ok: removeSignup(s.id) > 0 });
  });

  // ----- dashboard -----
  router.get('/dashboard', (req, res) => {
    const wingId = Number(req.query.wing_id);
    if (!wingId) return res.status(400).json({ error: 'missing_wing_id' });
    res.json(getDashboard(wingId, getActor(req).member?.id || null));
  });

  // KPI tiles shown above the fold on the Dashboard. Six numbers that tell an
  // admin "how's the wing today" at a glance.
  router.get('/wings/:id/dashboard-stats', (req, res) => {
    const wing = getWing(Number(req.params.id));
    if (!wing) return res.status(404).json({ error: 'not_found' });
    const now = Date.now();
    const day = 86_400_000;
    const ninetyDaysAgo = now - 90 * day;
    const thirtyDaysAhead = now + 30 * day;

    // 1. Active pilots (status = 'active' only)
    const members = getMembersByWing(wing.id);
    const activePilots = members.filter((m) => m.status === 'active').length;

    // 2. Currently-held qualifications (status = 'qualified' across all members)
    const qualsCurrentRow = db.prepare(`
      SELECT COUNT(*) AS n FROM member_quals mq
      JOIN members m ON m.id = mq.member_id
      WHERE m.wing_id = ? AND mq.status = 'qualified'
    `).get(wing.id);

    // 3. Qualifications expiring in the next 30 days (still qualified, but not for long)
    const qualsExpiringRow = db.prepare(`
      SELECT COUNT(*) AS n FROM member_quals mq
      JOIN members m ON m.id = mq.member_id
      WHERE m.wing_id = ? AND mq.status = 'qualified'
        AND mq.expires_at IS NOT NULL
        AND mq.expires_at <= ? AND mq.expires_at >= ?
    `).get(wing.id, thirtyDaysAhead, now);

    // 4. 90-day attendance rate — reuse the metrics aggregator.
    // getAttendanceMetrics returns rate as a percentage (e.g. 75 = 75%); the
    // KPI tile formatter expects a 0-1 fraction like boarding_rate. Convert.
    const attendance = getAttendanceMetrics(wing.id, ninetyDaysAgo, now);
    const attendance90d = attendance?.attendance_rate != null
      ? +(attendance.attendance_rate / 100).toFixed(2)
      : null;

    // 5. Flight hours (90d) — sum sortie seconds for this wing in the last 90d
    const hoursRow = db.prepare(`
      SELECT COALESCE(SUM(seconds), 0) AS s FROM sorties
      WHERE wing_id = ? AND created_at >= ?
    `).get(wing.id, ninetyDaysAgo);
    const flightHours90d = Math.round((hoursRow.s || 0) / 3600 * 10) / 10;

    // 6. Wing boarding rate — average across pilots with at least one trap.
    //    Reuse getWingGreenieBoard which already computes per-pilot boarding rate.
    const board = getWingGreenieBoard(wing.id);
    const withRate = board.filter((b) => b.boarding_rate != null);
    const boardingRate = withRate.length
      ? +(withRate.reduce((a, b) => a + b.boarding_rate, 0) / withRate.length).toFixed(2)
      : null;

    res.json({
      active_pilots: activePilots,
      quals_current: qualsCurrentRow.n,
      quals_expiring_30d: qualsExpiringRow.n,
      attendance_90d: attendance90d,
      flight_hours_90d: flightHours90d,
      boarding_rate: boardingRate,
      total_pilots: members.length,
    });
  });

  // =====================================================================
  // Epic 3: events / attendance / LOA / metrics
  // (reuses the `ms` date helper declared in the missions block above)
  // =====================================================================

  // ----- events / calendar -----
  router.get('/wings/:id/events', (req, res) => {
    const wing = getWing(Number(req.params.id));
    if (!wing) return res.status(404).json({ error: 'not_found' });
    const from = ms(req.query.from);
    const to = ms(req.query.to);
    if (from == null || to == null) return res.status(400).json({ error: 'missing_range' });
    res.json(getEventsInRange(wing.id, from, to, { squadronId: Number(req.query.squadron_id) || null }));
  });

  router.post('/events', requireAdmin, (req, res) => {
    const b = req.body || {};
    const wingId = Number(b.wing_id);
    if (!wingId || !getWing(wingId)) return res.status(400).json({ error: 'bad_wing' });
    if (!str(b.title, 200)) return res.status(400).json({ error: 'missing_title' });
    const start = ms(b.start_at);
    if (!start) return res.status(400).json({ error: 'missing_start_at' });
    const event = createEvent(wingId, {
      squadron_id: b.squadron_id ? Number(b.squadron_id) : null,
      title: str(b.title, 200), description: str(b.description, 8000),
      kind: b.kind, start_at: start, end_at: ms(b.end_at),
      multi_squadron: !!b.multi_squadron, track_attendance: b.track_attendance !== false,
      roles: b.roles, taskings: b.taskings,
    }, getActor(req).user?.id || null);

    // Fire-and-forget: publish to Discord via Ops Bot if the wing is wired up.
    // Sends the flight/slot roles so the bot can render its full sign-up panel.
    const wing = getWing(wingId);
    if (wing.ops_bot_url && wing.ops_bot_token && !wing.discord_paused) {
      opsbotPublishEvent(wing, {
        readyroom_event_id: event.id,
        signup_callback_url: signupCallback(wing),
        title: event.title,
        description: event.description,
        kind: event.kind,
        start_at: event.start_at,
        roles: event.roles,
        taskings: event.taskings,
        url: `${getBaseUrl()}/events/${event.id}`,
      }).then((r) => { if (r) setEventDiscord(event.id, r.channel_id, r.message_id); });
    }

    audit(req, wingId, 'created', 'event', event.id, `Event: ${event.title}`);
    res.json(event);
  });

  router.get('/events/:id', (req, res) => {
    const e = getEvent(Number(req.params.id));
    if (!e) return res.status(404).json({ error: 'not_found' });
    res.json({ ...e, roster: getEventRoster(e.id), attendance: getEventAttendance(e.id), signups: getEventSignups(e.id) });
  });

  // Sign the current user up for a flight slot (or toggle off). Site side of the
  // two-way sync — mirrors the Ops Bot's claim/withdraw. The signer is keyed by
  // their Discord id (the cross-system identity); we resolve their roster member
  // when one exists. Pushes the change to the Ops Bot panel if the event is wired.
  router.post('/events/:id/signups', (req, res) => {
    const e = getEvent(Number(req.params.id));
    if (!e) return res.status(404).json({ error: 'not_found' });
    const actor = getActor(req);
    if (!actor.user?.id) return res.status(401).json({ error: 'auth_required' });
    if (!assertWingAccess(req, e.wing_id)) return res.status(403).json({ error: 'forbidden_wing' });
    const roleLabel = str(req.body?.role_label, 80);
    const role = (e.roles || []).find((r) => r.label === roleLabel);
    if (!role) return res.status(400).json({ error: 'unknown_role' });

    // Qual gate: if the slot requires a qual, the signer's member must hold it.
    if (role.qual && actor.member && !memberHoldsQual(actor.member.id, role.qual)) {
      return res.status(403).json({ error: 'qual_required', qual: role.qual });
    }

    const result = claimEventSlot(e, {
      discord_user_id: actor.user.id, member_id: actor.member?.id || null,
      display_name: actor.member?.callsign || actor.user.username || null,
      role_label: roleLabel, source: 'site',
    });
    if (result.error === 'slot_full') return res.status(409).json({ error: 'slot_full' });
    pushSignupsToOpsBot(e.id); // reflect on the Discord panel (no-op if unwired)
    res.json({ ok: true, signups: getEventSignups(e.id) });
  });

  // Withdraw the current user from all slots on this event.
  router.delete('/events/:id/signups', (req, res) => {
    const e = getEvent(Number(req.params.id));
    if (!e) return res.status(404).json({ error: 'not_found' });
    const actor = getActor(req);
    if (!actor.user?.id) return res.status(401).json({ error: 'auth_required' });
    if (!assertWingAccess(req, e.wing_id)) return res.status(403).json({ error: 'forbidden_wing' });
    removeAllEventSignupsForUser(e.id, actor.user.id);
    pushSignupsToOpsBot(e.id);
    res.json({ ok: true, signups: getEventSignups(e.id) });
  });

  router.put('/events/:id', requireAdmin, (req, res) => {
    const e = getEvent(Number(req.params.id));
    if (!e) return res.status(404).json({ error: 'not_found' });
    const b = req.body || {};
    const updated = updateEvent(e.id, {
      squadron_id: b.squadron_id ?? e.squadron_id,
      title: str(b.title, 200) || e.title, description: str(b.description, 8000),
      kind: b.kind ?? e.kind, start_at: ms(b.start_at) ?? e.start_at, end_at: ms(b.end_at),
      multi_squadron: !!b.multi_squadron, track_attendance: b.track_attendance !== false,
      roles: b.roles ?? e.roles, taskings: b.taskings ?? e.taskings,
    });
    // Fire-and-forget: edit the Discord panel if we have one wired.
    const wing = getWing(updated.wing_id);
    if (wing?.ops_bot_url && wing?.ops_bot_token && !wing?.discord_paused && updated.discord_message_id) {
      opsbotEditEvent(wing, updated.discord_message_id, {
        readyroom_event_id: updated.id,
        signup_callback_url: signupCallback(wing),
        title: updated.title, description: updated.description, kind: updated.kind,
        start_at: updated.start_at, roles: updated.roles, taskings: updated.taskings,
        url: `${getBaseUrl()}/events/${updated.id}`,
      });
    }
    audit(req, updated.wing_id, 'updated', 'event', updated.id, `Event updated: ${updated.title}`);
    res.json(updated);
  });

  router.delete('/events/:id', requireAdmin, (req, res) => {
    const e = getEvent(Number(req.params.id));
    if (!e) return res.json({ ok: false });
    // Fire-and-forget: nuke the Discord embed before we drop the row.
    const wing = getWing(e.wing_id);
    if (wing?.ops_bot_url && wing?.ops_bot_token && !wing?.discord_paused && e.discord_message_id) {
      opsbotDeleteEvent(wing, e.discord_message_id);
    }
    const ok = deleteEvent(e.id) > 0;
    if (ok) audit(req, e.wing_id, 'deleted', 'event', e.id, `Event deleted: ${e.title}`);
    res.json({ ok });
  });

  // (Re)post the event to Discord. Removes the old message (if any) and posts a
  // fresh panel with the current roster — used to first-publish an event that
  // wasn't wired at create time, or to bump / refresh an existing post.
  router.post('/events/:id/republish', requireAdmin, async (req, res) => {
    const e = getEvent(Number(req.params.id));
    if (!e) return res.status(404).json({ error: 'not_found' });
    const wing = getWing(e.wing_id);
    if (!wing?.ops_bot_url || !wing?.ops_bot_token) {
      return res.status(400).json({ error: 'discord_not_configured' });
    }
    if (e.discord_message_id) await opsbotDeleteEvent(wing, e.discord_message_id).catch(() => {});
    const r = await opsbotPublishEvent(wing, {
      readyroom_event_id: e.id,
      signup_callback_url: signupCallback(wing),
      title: e.title, description: e.description, kind: e.kind,
      start_at: e.start_at, roles: e.roles, taskings: e.taskings,
      signups: getEventSignups(e.id),
      url: `${getBaseUrl()}/events/${e.id}`,
    });
    if (!r) { setEventDiscord(e.id, null, null); return res.status(502).json({ error: 'publish_failed' }); }
    setEventDiscord(e.id, r.channel_id, r.message_id);
    audit(req, e.wing_id, 'published', 'event', e.id, `Reposted to Discord: ${e.title}`);
    res.json({ ok: true, message_id: r.message_id });
  });

  // ----- attendance -----
  router.post('/events/:id/attendance', requireAdmin, (req, res) => {
    const e = getEvent(Number(req.params.id));
    if (!e) return res.status(404).json({ error: 'not_found' });
    const memberId = Number(req.body?.member_id);
    if (!memberId) return res.status(400).json({ error: 'missing_member_id' });
    try {
      markAttendance(e.id, memberId, req.body?.status, {
        recordedBy: getActor(req).user?.id, notes: str(req.body?.notes, 500),
      });
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message || 'mark_failed' });
    }
  });
  router.delete('/events/:id/attendance/:memberId', requireAdmin, (req, res) => {
    res.json({ ok: clearAttendance(Number(req.params.id), Number(req.params.memberId)) > 0 });
  });

  // ----- LOA -----
  router.get('/wings/:id/loas', (req, res) => {
    const wing = getWing(Number(req.params.id));
    if (!wing) return res.status(404).json({ error: 'not_found' });
    res.json(getUpcomingLOAs(wing.id));
  });
  router.post('/members/:id/loas', (req, res) => {
    const member = getMember(Number(req.params.id));
    if (!member) return res.status(404).json({ error: 'not_found' });
    const actor = getActor(req);
    if (!actor.isAdmin && actor.member?.id !== member.id) return res.status(403).json({ error: 'forbidden' });
    const b = req.body || {};
    try {
      const loa = createLOA(member.id, {
        start_at: ms(b.start_at), end_at: ms(b.end_at), reason: str(b.reason, 500),
      });
      audit(req, member.wing_id, 'created', 'loa', loa.id || member.id,
        `LOA requested for ${member.callsign || member.name}`);
      res.json(loa);
    } catch (err) {
      res.status(400).json({ error: err.message || 'bad_request' });
    }
  });
  router.put('/loas/:id', requireAdmin, (req, res) => {
    const loa = getLOA(Number(req.params.id));
    if (!loa) return res.status(404).json({ error: 'not_found' });
    try {
      const updated = setLOAStatus(loa.id, req.body?.status, getActor(req).user?.id);
      const wid = wingOf('loa', loa.id);
      if (wid != null) audit(req, wid, req.body?.status || 'updated', 'loa', loa.id, `LOA ${req.body?.status || 'updated'}`);
      res.json(updated);
    } catch (err) {
      res.status(400).json({ error: err.message || 'bad_request' });
    }
  });
  router.delete('/loas/:id', (req, res) => {
    const loa = getLOA(Number(req.params.id));
    if (!loa) return res.status(404).json({ error: 'not_found' });
    const actor = getActor(req);
    if (!actor.isAdmin && actor.member?.id !== loa.member_id) return res.status(403).json({ error: 'forbidden' });
    const wid = wingOf('loa', loa.id);
    const ok = deleteLOA(loa.id) > 0;
    if (ok && wid != null) audit(req, wid, 'deleted', 'loa', loa.id, 'LOA removed');
    res.json({ ok });
  });
  router.get('/members/:id/loas', (req, res) => {
    const member = getMember(Number(req.params.id));
    if (!member) return res.status(404).json({ error: 'not_found' });
    res.json(getMemberLOAs(member.id));
  });

  // ----- metrics -----
  router.get('/wings/:id/attendance-metrics', (req, res) => {
    const wing = getWing(Number(req.params.id));
    if (!wing) return res.status(404).json({ error: 'not_found' });
    const from = ms(req.query.from);
    const to = ms(req.query.to);
    if (from == null || to == null) return res.status(400).json({ error: 'missing_range' });
    res.json(getAttendanceMetrics(wing.id, from, to));
  });
  router.get('/wings/:id/pilot-performance', (req, res) => {
    const wing = getWing(Number(req.params.id));
    if (!wing) return res.status(404).json({ error: 'not_found' });
    const from = ms(req.query.from);
    const to = ms(req.query.to);
    if (from == null || to == null) return res.status(400).json({ error: 'missing_range' });
    res.json(getPilotPerformance(wing.id, from, to));
  });
  // Per-event timeseries — powers the bar charts on the Metrics page.
  router.get('/wings/:id/attendance-timeseries', (req, res) => {
    const wing = getWing(Number(req.params.id));
    if (!wing) return res.status(404).json({ error: 'not_found' });
    const from = ms(req.query.from);
    const to = ms(req.query.to);
    if (from == null || to == null) return res.status(400).json({ error: 'missing_range' });
    res.json(getAttendanceTimeseries(wing.id, from, to));
  });

  // ----- Phase 3.2: training session logging -----
  router.get('/wings/:id/training-summary', (req, res) => {
    const wing = getWing(Number(req.params.id));
    if (!wing) return res.status(404).json({ error: 'not_found' });
    res.json(getTrainingSummary(wing.id));
  });
  router.post('/wings/:id/training-sessions', requireAdmin, (req, res) => {
    const wing = getWing(Number(req.params.id));
    if (!wing) return res.status(404).json({ error: 'not_found' });
    try {
      const s = createTrainingSession(wing.id, req.body || {}, getActor(req).user?.id || null);
      audit(req, wing.id, 'logged', 'training_session', s.id,
        `Logged ${s.duration_minutes}min training session`);
      res.json(s);
    } catch (err) {
      res.status(400).json({ error: err.message || 'create_failed' });
    }
  });
  router.get('/members/:id/training-sessions', (req, res) => {
    res.json(getSessionsByPilot(Number(req.params.id), Math.min(200, Number(req.query.limit) || 50)));
  });
  router.get('/members/:id/instructor-log', (req, res) => {
    res.json(getSessionsByInstructor(Number(req.params.id), Math.min(200, Number(req.query.limit) || 50)));
  });
  router.put('/training-sessions/:id', requireAdmin, (req, res) => {
    const s = updateTrainingSession(Number(req.params.id), req.body || {});
    if (!s) return res.status(404).json({ error: 'not_found' });
    res.json(s);
  });
  router.delete('/training-sessions/:id', requireAdmin, (req, res) => {
    res.json({ ok: deleteTrainingSession(Number(req.params.id)) > 0 });
  });

  // ----- Phase 3.4: Training Docs CMS -----
  router.get('/wings/:id/documents', (req, res) => {
    const wing = getWing(Number(req.params.id));
    if (!wing) return res.status(404).json({ error: 'not_found' });
    res.json(getDocumentsByWing(wing.id));
  });
  router.post('/wings/:id/documents', requireAdmin, (req, res) => {
    const wing = getWing(Number(req.params.id));
    if (!wing) return res.status(404).json({ error: 'not_found' });
    try {
      const d = createDocument(wing.id, req.body || {}, getActor(req).user?.id || null);
      audit(req, wing.id, 'created', 'document', d.id, `Document: ${d.title} [${d.scope}${d.scope_id ? ':' + d.scope_id : ''}]`);
      res.json(d);
    } catch (err) {
      res.status(400).json({ error: err.message || 'create_failed' });
    }
  });
  router.get('/documents/:id', (req, res) => {
    const d = getDocument(Number(req.params.id));
    if (!d) return res.status(404).json({ error: 'not_found' });
    res.json(d);
  });
  router.put('/documents/:id', requireAdmin, (req, res) => {
    const d = updateDocument(Number(req.params.id), req.body || {});
    if (!d) return res.status(404).json({ error: 'not_found' });
    audit(req, d.wing_id, 'updated', 'document', d.id, `Document updated: ${d.title}`);
    res.json(d);
  });
  router.delete('/documents/:id', requireAdmin, (req, res) => {
    const d = getDocument(Number(req.params.id));
    if (!d) return res.json({ ok: false });
    // Drop the attached file alongside the row (best-effort).
    if (d.file_path) deleteDocFile(d.file_path);
    const ok = deleteDocument(d.id) > 0;
    if (ok) audit(req, d.wing_id, 'deleted', 'document', d.id, `Document deleted: ${d.title}`);
    res.json({ ok });
  });

  // File attachment endpoints. PUT takes the raw bytes as the request body —
  // simpler than multipart, no extra dep. Filename + content-type come from
  // headers (set by the browser's fetch when passing a File object directly).
  router.put('/documents/:id/file',
    requireAdmin,
    raw({ type: '*/*', limit: MAX_DOC_FILE_BYTES + 64 }),
    (req, res) => {
      const d = getDocument(Number(req.params.id));
      if (!d) return res.status(404).json({ error: 'not_found' });
      if (!req.body || !req.body.length) return res.status(400).json({ error: 'empty_body' });
      if (req.body.length > MAX_DOC_FILE_BYTES) return res.status(413).json({ error: 'too_large' });
      // Filename comes from X-File-Name header (URL-encoded) or query param.
      // decodeURIComponent throws on malformed percent-escapes — fall back to
      // the raw value instead of 500-ing the upload.
      const rawHeader = req.get('x-file-name') || req.query.filename || 'file';
      let rawName;
      try { rawName = decodeURIComponent(rawHeader); } catch { rawName = String(rawHeader); }
      const mime = req.get('x-file-type') || req.get('content-type') || 'application/octet-stream';
      // Drop any existing file before writing the new one.
      if (d.file_path) deleteDocFile(d.file_path);
      const rel = saveDocFile(d.wing_id, d.id, rawName, req.body);
      const updated = setDocumentFile(d.id, {
        file_path: rel, file_name: rawName, mime_type: mime, file_size: req.body.length,
      });
      audit(req, d.wing_id, 'uploaded', 'document_file', d.id,
        `Uploaded ${rawName} (${(req.body.length / 1024).toFixed(1)} KB) to "${d.title}"`);
      res.json(updated);
    }
  );

  router.delete('/documents/:id/file', requireAdmin, (req, res) => {
    const d = getDocument(Number(req.params.id));
    if (!d) return res.status(404).json({ error: 'not_found' });
    if (d.file_path) deleteDocFile(d.file_path);
    const updated = clearDocumentFile(d.id);
    audit(req, d.wing_id, 'deleted', 'document_file', d.id,
      `Removed file ${d.file_name || ''} from "${d.title}"`);
    res.json(updated);
  });

  // Streamed file download. Same wing access as the doc (already enforced by
  // the nested-resource guard for /documents/:id paths).
  router.get('/documents/:id/file', (req, res) => {
    const d = getDocument(Number(req.params.id));
    if (!d) return res.status(404).json({ error: 'not_found' });
    if (!d.file_path) return res.status(404).json({ error: 'no_file' });
    const file = readDocFile(d.file_path);
    if (!file) return res.status(404).json({ error: 'file_missing' });
    res.setHeader('Content-Type', d.mime_type || 'application/octet-stream');
    res.setHeader('Content-Length', file.size);
    res.setHeader('Content-Disposition',
      `inline; filename="${(d.file_name || 'file').replace(/"/g, '')}"`);
    res.send(file.buffer);
  });

  // ----- Cross-Squadron enrollment -----
  router.get('/squadrons/:id/enrollees', (req, res) => {
    res.json(getEnrollees(Number(req.params.id)));
  });
  router.post('/squadrons/:id/enroll', requireAdmin, (req, res) => {
    const memberId = Number(req.body?.member_id);
    if (!memberId) return res.status(400).json({ error: 'missing_member_id' });
    const m = getMember(memberId);
    if (!m) return res.status(404).json({ error: 'member_not_found' });
    if (m.squadron_id === Number(req.params.id)) return res.status(400).json({ error: 'already_primary' });
    const result = enrollPilot(req.params.id, memberId, str(req.body?.notes, 500));
    audit(req, m.wing_id, 'enrolled', 'cross_squadron', memberId,
      `Enrolled ${m.callsign || m.name} in squadron #${req.params.id}`);
    res.json(result);
  });
  router.delete('/squadrons/:id/enroll/:memberId', requireAdmin, (req, res) => {
    const sqnId = Number(req.params.id);
    const memberId = Number(req.params.memberId);
    const ok = unenrollPilot(sqnId, memberId) > 0;
    if (ok) {
      const m = getMember(memberId);
      if (m) audit(req, m.wing_id, 'unenrolled', 'cross_squadron', memberId,
        `Unenrolled ${m.callsign || m.name} from squadron #${sqnId}`);
    }
    res.json({ ok });
  });

  // ----- Phase 3.3: crew-position tracks on quals -----
  router.get('/quals/:id/tracks', (req, res) => {
    res.json(getQualTracks(Number(req.params.id)));
  });
  router.post('/quals/:id/tracks', requireAdmin, (req, res) => {
    const q = getQual(Number(req.params.id));
    if (!q) return res.status(404).json({ error: 'not_found' });
    try {
      const track = createQualTrack(q.id, req.body || {});
      audit(req, q.wing_id, 'created', 'qual_track', q.id, `Added crew track "${track.label}" to ${q.code}`);
      res.json(track);
    } catch (err) {
      res.status(400).json({ error: err.message || 'create_failed' });
    }
  });
  router.delete('/qual-tracks/:id', requireAdmin, (req, res) => {
    const wid = wingOf('qual_track', Number(req.params.id));
    const ok = deleteQualTrack(Number(req.params.id)) > 0;
    if (ok && wid != null) audit(req, wid, 'deleted', 'qual_track', Number(req.params.id), 'Removed crew track');
    res.json({ ok });
  });

  // ----- Phase 3.1: modex pools -----
  router.get('/wings/:id/modex-pools', (req, res) => {
    const wing = getWing(Number(req.params.id));
    if (!wing) return res.status(404).json({ error: 'not_found' });
    res.json(getModexPools(wing.id));
  });
  router.put('/wings/:id/modex-pools/:subdivision', requireAdmin, (req, res) => {
    const wing = getWing(Number(req.params.id));
    if (!wing) return res.status(404).json({ error: 'not_found' });
    try {
      const p = setModexPool(wing.id, req.params.subdivision, req.body || {});
      audit(req, wing.id, 'updated', 'modex_pool', wing.id,
        `Set ${req.params.subdivision} modex range ${p.range_start}-${p.range_end}`);
      res.json(p);
    } catch (err) {
      res.status(400).json({ error: err.message || 'bad_input' });
    }
  });
  router.delete('/wings/:id/modex-pools/:subdivision', requireAdmin, (req, res) => {
    const wing = getWing(Number(req.params.id));
    if (!wing) return res.status(404).json({ error: 'not_found' });
    const ok = deleteModexPool(wing.id, req.params.subdivision) > 0;
    if (ok) audit(req, wing.id, 'deleted', 'modex_pool', wing.id,
      `Removed ${req.params.subdivision} modex pool`);
    res.json({ ok });
  });
  // Next-available hint — used inline on Personnel + Squadron pages.
  router.get('/wings/:id/modex-pools/:subdivision/available', (req, res) => {
    const wing = getWing(Number(req.params.id));
    if (!wing) return res.status(404).json({ error: 'not_found' });
    res.json(getAvailableModex(wing.id, req.params.subdivision, 20));
  });

  // ----- demo wing spawner (root-admin only) -----
  // Drops a fully-fleshed-out demo wing into the DB for showcase purposes.
  // Owner is set as admin so the wing shows up in their /api/wings list via
  // the membership-scoped filter. Safe to call multiple times — each call
  // creates a new wing; delete via the standard wing delete endpoint when done.
  router.post('/admin/seed-demo', (req, res) => {
    const actor = getActor(req);
    if (!actor.root) return res.status(403).json({ error: 'root_only' });
    if (!actor.user?.id) return res.status(400).json({ error: 'no_user_id' });
    try {
      const result = seedDemoWing({
        discordUserId: actor.user.id,
        username: actor.user.username || 'Wing CO',
      });
      audit(req, result.wing_id, 'created', 'demo_wing', result.wing_id,
        `Spawned demo wing #${result.wing_id} for ${actor.user.username || actor.user.id}`,
        result.summary);
      res.json(result);
    } catch (err) {
      console.error('[seed-demo] failed:', err);
      res.status(500).json({ error: err.message || 'seed_failed' });
    }
  });

  // ----- audit log (admin-only) -----
  router.get('/wings/:id/audit-log', requireAdmin, (req, res) => {
    const wing = getWing(Number(req.params.id));
    if (!wing) return res.status(404).json({ error: 'not_found' });
    res.json({
      filters: getAuditFilters(wing.id),
      entries: getAuditLog(wing.id, {
        entity_type: req.query.entity_type || null,
        actor_id: req.query.actor_id || null,
        from: req.query.from ? Number(req.query.from) : null,
        to: req.query.to ? Number(req.query.to) : null,
        limit: Number(req.query.limit) || 200,
      }),
    });
  });

  // ----- onboarding / setup walkthrough -----
  router.get('/wings/:id/setup-status', (req, res) => {
    const wing = getWing(Number(req.params.id));
    if (!wing) return res.status(404).json({ error: 'not_found' });
    const squadronCount = getSquadrons(wing.id).length;
    const qualCount = getQuals(wing.id).length;
    const memberCount = getMembersByWing(wing.id).length;
    const carrierCount = getCarriers(wing.id).length;
    // sortie hook is "alive" once any sortie has landed for this wing
    const sortieCount = getRecentSorties(wing.id, 1).length;
    const discordWired = !!(wing.ops_bot_url && wing.ops_bot_token);
    const steps = {
      squadrons:  { done: squadronCount >= 1, count: squadronCount },
      quals:      { done: qualCount >= 1,     count: qualCount },
      roster:     { done: memberCount >= 3,   count: memberCount },
      dcs_hook:   { done: sortieCount >= 1,   count: sortieCount },
      discord:    { done: discordWired,       count: discordWired ? 1 : 0 },
      carrier:    { done: carrierCount >= 1,  count: carrierCount, optional: true },
    };
    const required = ['squadrons', 'quals', 'roster', 'dcs_hook', 'discord'];
    const done = required.filter((k) => steps[k].done).length;
    res.json({ wing_id: wing.id, steps, complete: done, total: required.length });
  });

  // ----- carriers / LSO (Epic 6) -----
  router.get('/wings/:id/carriers', (req, res) => {
    const wing = getWing(Number(req.params.id));
    if (!wing) return res.status(404).json({ error: 'not_found' });
    res.json(getCarriers(wing.id));
  });
  router.post('/wings/:id/carriers', requireAdmin, (req, res) => {
    const wing = getWing(Number(req.params.id));
    if (!wing) return res.status(404).json({ error: 'not_found' });
    const carrier = createCarrier(wing.id, req.body || {});
    audit(req, wing.id, 'created', 'carrier', carrier.id, `Added carrier ${carrier.name}${carrier.hull ? ` (${carrier.hull})` : ''}`);
    res.json(carrier);
  });
  router.get('/carriers/:id', (req, res) => {
    const c = getCarrier(Number(req.params.id));
    if (!c) return res.status(404).json({ error: 'not_found' });
    res.json({ ...c, recent_traps: getTrapsByCarrier(c.id, 50) });
  });
  router.put('/carriers/:id', requireAdmin, (req, res) => {
    const c = getCarrier(Number(req.params.id));
    if (!c) return res.status(404).json({ error: 'not_found' });
    const updated = updateCarrier(c.id, req.body || {});
    audit(req, c.wing_id, 'updated', 'carrier', c.id, `Updated carrier ${updated.name}`);
    res.json(updated);
  });
  router.delete('/carriers/:id', requireAdmin, (req, res) => {
    const c = getCarrier(Number(req.params.id));
    if (!c) return res.json({ ok: false });
    const ok = deleteCarrier(c.id) > 0;
    if (ok) audit(req, c.wing_id, 'deleted', 'carrier', c.id, `Deleted carrier ${c.name}`);
    res.json({ ok });
  });

  // traps
  router.post('/carriers/:id/traps', requireAdmin, (req, res) => {
    const c = getCarrier(Number(req.params.id));
    if (!c) return res.status(404).json({ error: 'not_found' });
    try {
      const trap = recordTrap(c.id, req.body || {}, getActor(req).user?.id || null);
      audit(req, c.wing_id, 'logged', 'trap', trap.id,
        `Trap on ${c.name}: grade ${trap.grade}${trap.wire ? ` wire ${trap.wire}` : ''}`);
      res.json(trap);
    } catch (err) {
      res.status(400).json({ error: err.message || 'record_failed' });
    }
  });
  router.delete('/traps/:id', requireAdmin, (req, res) => {
    const wid = wingOf('trap', Number(req.params.id));
    const ok = deleteTrap(Number(req.params.id)) > 0;
    if (ok && wid != null) audit(req, wid, 'deleted', 'trap', Number(req.params.id), 'Trap removed');
    res.json({ ok });
  });
  router.get('/traps/:id', (req, res) => {
    const t = getTrap(Number(req.params.id));
    if (!t) return res.status(404).json({ error: 'not_found' });
    res.json(t);
  });
  router.get('/members/:id/traps', (req, res) => {
    const member = getMember(Number(req.params.id));
    if (!member) return res.status(404).json({ error: 'not_found' });
    res.json({
      stats: getMemberBoardingStats(member.id),
      traps: getTrapsByMember(member.id, 50),
    });
  });
  router.get('/events/:id/traps', (req, res) => {
    res.json(getTrapsByEvent(Number(req.params.id)));
  });
  router.get('/wings/:id/greenie-board', (req, res) => {
    const wing = getWing(Number(req.params.id));
    if (!wing) return res.status(404).json({ error: 'not_found' });
    res.json({ grades_taxonomy: TRAP_GRADES, board: getWingGreenieBoard(wing.id) });
  });

  return router;
}
