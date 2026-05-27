import { Router } from 'express';
import { getWingByIngestToken, addSortie } from '../db/index.js';

// Public, token-authenticated endpoint for sortie telemetry (machine-to-machine).
// The token maps to a wing. Mounted OUTSIDE the dashboard's session auth.
//
// Expected body (mirrors VectorBot's event batch shape so the same DCS hook can fan out):
//   { type: "sorties", sorties: [ { pilot, airframe, seconds, started_at } ] }
// Sortie rows are attributed to a member via the pilot-alias map at insert time;
// unmatched pilots are stored with member_id NULL and surface under /unmatched-aliases.
export function ingestRouter() {
  const router = Router();

  router.post('/:token', (req, res) => {
    const wing = getWingByIngestToken(req.params.token);
    if (!wing) return res.status(401).json({ error: 'bad_token' });

    const b = req.body || {};
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
