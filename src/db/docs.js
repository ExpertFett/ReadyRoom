/**
 * Training Docs — wing-scoped documentation library.
 *
 * Each document has a scope tuple: (wing) for wing-wide SOPs, (squadron, id)
 * for squadron-specific docs, (qual, id) for per-qualification syllabus
 * material. Content is stored as plain text / markdown for now; file uploads
 * can be layered on later (would add file_path / mime / size columns).
 *
 * This is the system Deckboss migrated to after explicitly deprecating inline
 * "description URL" + "activity description" fields on quals. Quals become
 * containers for docs, not blobs.
 */

import db from './index.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS documents (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    wing_id     INTEGER NOT NULL REFERENCES wings(id) ON DELETE CASCADE,
    scope       TEXT NOT NULL,             -- 'wing' | 'squadron' | 'qual'
    scope_id    INTEGER,                   -- NULL for scope='wing'
    title       TEXT NOT NULL,
    content     TEXT,                      -- markdown
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_by  TEXT,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_documents_scope ON documents (wing_id, scope, scope_id);
`);

const str = (v, n) => (v == null || v === '' ? null : String(v).slice(0, n));
const SCOPES = ['wing', 'squadron', 'qual'];

const insertDocStmt = db.prepare(`
  INSERT INTO documents (wing_id, scope, scope_id, title, content, sort_order,
    created_by, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const selectDocStmt = db.prepare('SELECT * FROM documents WHERE id = ?');
const updateDocStmt = db.prepare(`
  UPDATE documents SET title = ?, content = ?, sort_order = ?, updated_at = ?
  WHERE id = ?
`);
const deleteDocStmt = db.prepare('DELETE FROM documents WHERE id = ?');

export function createDocument(wingId, d, createdBy) {
  if (!SCOPES.includes(d.scope)) throw new Error('bad_scope');
  if (!d.title || !String(d.title).trim()) throw new Error('missing_title');
  const now = Date.now();
  const r = insertDocStmt.run(
    wingId,
    d.scope,
    d.scope === 'wing' ? null : (d.scope_id ? Number(d.scope_id) : null),
    String(d.title).trim().slice(0, 200),
    str(d.content, 100_000),
    Number(d.sort_order) || 0,
    createdBy || null,
    now, now,
  );
  return getDocument(Number(r.lastInsertRowid));
}

export function getDocument(id) {
  return selectDocStmt.get(id) || null;
}

export function updateDocument(id, d) {
  const cur = getDocument(id);
  if (!cur) return null;
  updateDocStmt.run(
    d.title !== undefined ? String(d.title).trim().slice(0, 200) : cur.title,
    d.content !== undefined ? str(d.content, 100_000) : cur.content,
    d.sort_order !== undefined ? (Number(d.sort_order) || 0) : cur.sort_order,
    Date.now(),
    id,
  );
  return getDocument(id);
}

export function deleteDocument(id) {
  return deleteDocStmt.run(id).changes;
}

// Library view — every document for a wing, indexed by scope tuple. Used by
// the /docs page to render the tree + main grid.
const selectDocsByWingStmt = db.prepare(`
  SELECT d.*,
         sq.tag AS sqn_tag, sq.name AS sqn_name,
         q.code AS qual_code, q.name AS qual_name
  FROM documents d
  LEFT JOIN squadrons sq ON d.scope = 'squadron' AND sq.id = d.scope_id
  LEFT JOIN quals q ON d.scope = 'qual' AND q.id = d.scope_id
  WHERE d.wing_id = ?
  ORDER BY d.scope, d.scope_id, d.sort_order, d.created_at
`);

export function getDocumentsByWing(wingId) {
  return selectDocsByWingStmt.all(wingId);
}

const selectDocsByScopeStmt = db.prepare(`
  SELECT * FROM documents WHERE wing_id = ? AND scope = ?
    AND (? IS NULL OR scope_id = ?)
  ORDER BY sort_order, created_at
`);
export function getDocumentsByScope(wingId, scope, scopeId = null) {
  return selectDocsByScopeStmt.all(wingId, scope, scopeId, scopeId);
}
