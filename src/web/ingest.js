import { Router } from 'express';
import { getWingByIngestToken, addSortie, getMemberByDiscord, memberHoldsQual } from '../db/index.js';
import { getEvent, getEventSignups, claimEventSlot, removeAllEventSignupsForUser } from '../db/events.js';

// Public, token-authenticated endpoint for sortie telemetry (machine-to-machine).
// The token maps to a wing. Mounted OUTSIDE the dashboard's session auth.
//
// Expected body (mirrors VectorBot's event batch shape so the same DCS hook can fan out):
//   { type: "sorties", sorties: [ { pilot, airframe, seconds, started_at } ] }
// Sortie rows are attributed to a member via the pilot-alias map at insert time;
// unmatched pilots are stored with member_id NULL and surface under /unmatched-aliases.
export function ingestRouter() {
  const router = Router();

  // GET ingest URL — used by the Ops Bot dashboard's "Test connection" button to
  // confirm the configured URL+token reaches a real wing without sending data.
  router.get('/:token', (req, res) => {
    const wing = getWingByIngestToken(req.params.token);
    if (!wing) return res.status(401).json({ error: 'bad_token' });
    res.json({ ok: true, wing: { id: wing.id, name: wing.name, tag: wing.tag || null } });
  });

  router.post('/:token', (req, res) => {
    const wing = getWingByIngestToken(req.params.token);
    if (!wing) return res.status(401).json({ error: 'bad_token' });

    const b = req.body || {};

    // Ops Bot -> ReadyRoom: a Discord user clicked a sign-up button on a
    // published event panel. We are the source of truth for the roster, so we
    // apply the claim/toggle here and return the fresh sign-up list; the bot
    // re-renders its panel from the response. Keyed by Discord id (cross-system
    // identity); resolved to a roster member when one exists, else a guest.
    if (b.type === 'event_signup') {
      const ev = getEvent(Number(b.readyroom_event_id));
      if (!ev || ev.wing_id !== wing.id) return res.status(404).json({ error: 'event_not_found' });
      const discordId = String(b.discord_user_id || '');
      if (!discordId) return res.status(400).json({ error: 'missing_user' });
      const member = getMemberByDiscord(discordId);

      if (b.action === 'withdraw' || !b.role_label) {
        removeAllEventSignupsForUser(ev.id, discordId);
        return res.json({ ok: true, signups: getEventSignups(ev.id) });
      }
      const role = (ev.roles || []).find((r) => r.label === String(b.role_label));
      if (!role) return res.status(400).json({ error: 'unknown_role' });
      if (role.qual && member && !memberHoldsQual(member.id, role.qual)) {
        return res.status(403).json({ error: 'qual_required', qual: role.qual, signups: getEventSignups(ev.id) });
      }
      const result = claimEventSlot(ev, {
        discord_user_id: discordId, member_id: member?.id || null,
        display_name: member?.callsign || (b.username ? String(b.username) : null),
        role_label: String(b.role_label), source: 'discord',
      });
      if (result.error === 'slot_full') {
        return res.status(409).json({ error: 'slot_full', signups: getEventSignups(ev.id) });
      }
      return res.json({ ok: true, signups: getEventSignups(ev.id) });
    }

    const list = Array.isArray(b.sorties) ? b.sorties : Array.isArray(b) ? b : [];
    let accepted = 0;
    for (const s of list.slice(0, 200)) {
      const pilot = s.pilot || s.alias || s.name;
      if (!pilot) continue;
      try {
        addSortie(wing.id, {
          alias: pilot,
          airframe: s.airframe || s.aircraft || null,
          seconds: s.seconds,
          source: b.source || 'ingest',
          started_at: Number(s.started_at) || null,
        });
        accepted++;
      } catch {
        /* skip bad row */
      }
    }
    res.json({ ok: true, accepted });
  });

  return router;
}
