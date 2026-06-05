/**
 * Resource → wing_id resolver. Used by the API layer to enforce multi-tenant
 * access on nested resources keyed by their own ID (not wing_id).
 *
 * The /api/wings/:id middleware in api.js handles wing-scoped paths and any
 * request that carries a wing_id query/body param. Nested resources need
 * their own wing_id lookup; that's what this module is for.
 *
 * Usage in a handler:
 *
 *   const wingId = wingOf('member', req.params.id);
 *   if (wingId == null) return res.status(404).json({ error: 'not_found' });
 *   if (!assertWingAccess(req, wingId)) return res.status(403).json({...});
 */

import db from './index.js';

// Prepared statements are lazy because some tables may not exist yet when
// this module first loads (cross-module schema ordering). Memoize them.
const cache = {};
function stmt(key, sql) {
  if (!cache[key]) cache[key] = db.prepare(sql);
  return cache[key];
}

// Each resolver returns the wing_id integer, or null if not found.
const RESOLVERS = {
  squadron:         (id) => stmt('squadron',         'SELECT wing_id FROM squadrons WHERE id = ?').get(id),
  member:           (id) => stmt('member',           'SELECT wing_id FROM members WHERE id = ?').get(id),
  alias:            (id) => stmt('alias',            'SELECT m.wing_id AS wing_id FROM pilot_aliases a JOIN members m ON m.id = a.member_id WHERE a.id = ?').get(id),
  qual:             (id) => stmt('qual',             'SELECT wing_id FROM quals WHERE id = ?').get(id),
  activity:         (id) => stmt('activity',         'SELECT q.wing_id AS wing_id FROM qual_activities a JOIN quals q ON q.id = a.qual_id WHERE a.id = ?').get(id),
  qual_track:       (id) => stmt('qual_track',       'SELECT q.wing_id AS wing_id FROM qual_tracks t JOIN quals q ON q.id = t.qual_id WHERE t.id = ?').get(id),
  campaign:         (id) => stmt('campaign',         'SELECT wing_id FROM campaigns WHERE id = ?').get(id),
  mission:          (id) => stmt('mission',          'SELECT wing_id FROM missions WHERE id = ?').get(id),
  flight:           (id) => stmt('flight',           'SELECT m.wing_id AS wing_id FROM mission_flights f JOIN missions m ON m.id = f.mission_id WHERE f.id = ?').get(id),
  resource:         (id) => stmt('resource',         'SELECT m.wing_id AS wing_id FROM mission_resources r JOIN missions m ON m.id = r.mission_id WHERE r.id = ?').get(id),
  signup:           (id) => stmt('signup',           'SELECT m.wing_id AS wing_id FROM mission_signups s JOIN missions m ON m.id = s.mission_id WHERE s.id = ?').get(id),
  event:            (id) => stmt('event',            'SELECT wing_id FROM events WHERE id = ?').get(id),
  loa:              (id) => stmt('loa',              'SELECT m.wing_id AS wing_id FROM loa_requests l JOIN members m ON m.id = l.member_id WHERE l.id = ?').get(id),
  training_session: (id) => stmt('training_session', 'SELECT wing_id FROM training_sessions WHERE id = ?').get(id),
  document:         (id) => stmt('document',         'SELECT wing_id FROM documents WHERE id = ?').get(id),
  carrier:          (id) => stmt('carrier',          'SELECT wing_id FROM carriers WHERE id = ?').get(id),
  trap:             (id) => stmt('trap',             'SELECT c.wing_id AS wing_id FROM traps t JOIN carriers c ON c.id = t.carrier_id WHERE t.id = ?').get(id),
};

export function wingOf(type, id) {
  const r = RESOLVERS[type];
  if (!r) throw new Error(`unknown resource type: ${type}`);
  const n = Number(id);
  if (!Number.isFinite(n)) return null;
  const row = r(n);
  return row?.wing_id ?? null;
}
