/**
 * Audit log — track every admin-level write to wing-scoped data.
 *
 * Triggered by the API layer via logAction() inside the handlers that
 * mutate state. We keep the schema minimal:
 *
 *   wing_id     — which tenant
 *   actor_id    — Discord user ID who did the thing
 *   actor_name  — username at write time (so the log survives renames)
 *   action      — verb: created / updated / deleted / signed-off / etc.
 *   entity_type — 'member', 'qual', 'event', 'document', etc.
 *   entity_id   — the affected row's primary key, when there's one
 *   summary     — short human-readable line for the viewer
 *   detail      — optional JSON blob with field-level diffs / payload
 *
 * For browse performance, indexed on (wing_id, created_at DESC).
 */

import db from './index.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS audit_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    wing_id     INTEGER NOT NULL REFERENCES wings(id) ON DELETE CASCADE,
    actor_id    TEXT,
    actor_name  TEXT,
    action      TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id   INTEGER,
    summary     TEXT,
    detail      TEXT,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_audit_wing_time ON audit_log (wing_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log (entity_type, entity_id);
`);

const insertStmt = db.prepare(`
  INSERT INTO audit_log
    (wing_id, actor_id, actor_name, action, entity_type, entity_id, summary, detail, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

/**
 * Log a single mutation. Best-effort — never throws; failures here must not
 * break the underlying write. Caller passes the actor (from getActor()) and
 * everything we know about the change.
 *
 * @param {object} entry
 * @param {number} entry.wing_id
 * @param {{id?:string, username?:string}} [entry.actor]
 * @param {string} entry.action       e.g. 'created', 'updated', 'deleted'
 * @param {string} entry.entity_type  e.g. 'member', 'qual', 'document'
 * @param {number} [entry.entity_id]
 * @param {string} [entry.summary]
 * @param {object} [entry.detail]
 */
export function logAction(entry) {
  if (!entry || !entry.wing_id || !entry.action || !entry.entity_type) return;
  try {
    insertStmt.run(
      Number(entry.wing_id),
      entry.actor?.id ? String(entry.actor.id) : null,
      entry.actor?.username ? String(entry.actor.username).slice(0, 120) : null,
      String(entry.action).slice(0, 32),
      String(entry.entity_type).slice(0, 32),
      entry.entity_id != null ? Number(entry.entity_id) : null,
      entry.summary ? String(entry.summary).slice(0, 500) : null,
      entry.detail != null ? JSON.stringify(entry.detail).slice(0, 4000) : null,
      Date.now(),
    );
  } catch (err) {
    console.warn('[audit] failed:', err.message);
  }
}

const selectByWingStmt = db.prepare(`
  SELECT * FROM audit_log
  WHERE wing_id = ?
    AND (? IS NULL OR entity_type = ?)
    AND (? IS NULL OR actor_id = ?)
    AND (? IS NULL OR created_at >= ?)
    AND (? IS NULL OR created_at <= ?)
  ORDER BY created_at DESC
  LIMIT ?
`);

export function getAuditLog(wingId, { entity_type = null, actor_id = null, from = null, to = null, limit = 100 } = {}) {
  const lim = Math.min(1000, Math.max(1, Number(limit) || 100));
  return selectByWingStmt.all(
    Number(wingId),
    entity_type, entity_type,
    actor_id, actor_id,
    from, from,
    to, to,
    lim,
  ).map((r) => ({
    ...r,
    detail: r.detail ? safeParse(r.detail) : null,
  }));
}

function safeParse(s) { try { return JSON.parse(s); } catch { return s; } }

// Distinct entity types + actors that have actually written for this wing —
// powers the filter dropdowns on the viewer page.
export function getAuditFilters(wingId) {
  const types = db.prepare('SELECT DISTINCT entity_type FROM audit_log WHERE wing_id = ? ORDER BY entity_type').all(wingId).map((r) => r.entity_type);
  const actors = db.prepare(
    `SELECT DISTINCT actor_id, actor_name FROM audit_log
     WHERE wing_id = ? AND actor_id IS NOT NULL
     ORDER BY actor_name`
  ).all(wingId);
  return { entity_types: types, actors };
}
