import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { config } from '../config.js';

mkdirSync(dirname(config.dbPath), { recursive: true });

const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS wings (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    tag          TEXT,
    description  TEXT,
    ingest_token TEXT,
    created_at   INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS squadrons (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    wing_id     INTEGER NOT NULL REFERENCES wings(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    tag         TEXT,
    aircraft    TEXT,
    description TEXT,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_squadrons_wing ON squadrons (wing_id);

  CREATE TABLE IF NOT EXISTS members (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    wing_id         INTEGER NOT NULL REFERENCES wings(id) ON DELETE CASCADE,
    squadron_id     INTEGER REFERENCES squadrons(id) ON DELETE SET NULL,
    discord_user_id TEXT,
    callsign        TEXT,
    name            TEXT,
    rank            TEXT,
    billet          TEXT,
    airframes       TEXT,
    status          TEXT NOT NULL DEFAULT 'active',
    app_role        TEXT NOT NULL DEFAULT 'member',
    notes           TEXT,
    joined_at       INTEGER,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_members_wing ON members (wing_id);
  CREATE INDEX IF NOT EXISTS idx_members_squadron ON members (squadron_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_members_discord
    ON members (discord_user_id) WHERE discord_user_id IS NOT NULL;

  -- The identity bridge: an in-game DCS pilot name string -> a roster member.
  CREATE TABLE IF NOT EXISTS pilot_aliases (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id  INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    alias      TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_aliases_alias ON pilot_aliases (alias);
  CREATE INDEX IF NOT EXISTS idx_aliases_member ON pilot_aliases (member_id);

  CREATE TABLE IF NOT EXISTS quals (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    wing_id     INTEGER NOT NULL REFERENCES wings(id) ON DELETE CASCADE,
    code        TEXT NOT NULL,
    name        TEXT NOT NULL,
    category    TEXT,
    description TEXT,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_quals_wing_code ON quals (wing_id, code);

  CREATE TABLE IF NOT EXISTS member_quals (
    member_id  INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    qual_id    INTEGER NOT NULL REFERENCES quals(id) ON DELETE CASCADE,
    status     TEXT NOT NULL DEFAULT 'qualified',
    awarded_at INTEGER,
    expires_at INTEGER,
    notes      TEXT,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (member_id, qual_id)
  );

  -- Sortie activity, populated later by ingest (DCS hook / VectorBot mirror).
  -- member_id is resolved via pilot_aliases at ingest time (nullable = unmatched).
  CREATE TABLE IF NOT EXISTS sorties (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    wing_id    INTEGER NOT NULL REFERENCES wings(id) ON DELETE CASCADE,
    member_id  INTEGER REFERENCES members(id) ON DELETE SET NULL,
    alias      TEXT NOT NULL,
    airframe   TEXT,
    seconds    INTEGER NOT NULL DEFAULT 0,
    source     TEXT,
    started_at INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sorties_wing ON sorties (wing_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_sorties_member ON sorties (member_id, created_at);
`);

// Idempotent column migrations (SQLite has no "ADD COLUMN IF NOT EXISTS").
export function ensureColumn(table, column, type) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

// --- Epic 1: roster & org depth ---
ensureColumn('members', 'modex', 'TEXT');                              // hull/side number, e.g. "412"
ensureColumn('members', 'subdivision', "TEXT NOT NULL DEFAULT 'main'"); // main|ready_reserve|candidate|frs
ensureColumn('squadrons', 'kind', "TEXT NOT NULL DEFAULT 'squadron'");  // squadron|detachment
ensureColumn('quals', 'is_tier', 'INTEGER NOT NULL DEFAULT 0');        // counts toward readiness tier
ensureColumn('quals', 'tier_order', 'INTEGER');                        // progression order (lower = earlier)
ensureColumn('quals', 'tier_label', 'TEXT');                           // tier granted when achieved (e.g. CMQ -> "FMQ")

// --- Epic 5b: Ops Bot publish bridge (Discord event embeds) ---
ensureColumn('wings', 'ops_bot_url', 'TEXT');     // base URL of the Ops Bot (e.g. https://dcsoptbot-production-0c4b.up.railway.app)
ensureColumn('wings', 'ops_bot_token', 'TEXT');   // per-guild outbound token revealed by the Ops Bot dashboard

const safeParse = (s, fallback) => {
  try {
    return s ? JSON.parse(s) : fallback;
  } catch {
    return fallback;
  }
};

// ---------------------------------------------------------------------------
// Wings
// ---------------------------------------------------------------------------
const insertWing = db.prepare(
  'INSERT INTO wings (name, tag, description, created_at) VALUES (?, ?, ?, ?)'
);
const selectWings = db.prepare('SELECT * FROM wings ORDER BY id ASC');
const selectWing = db.prepare('SELECT * FROM wings WHERE id = ?');
const updateWingStmt = db.prepare(
  'UPDATE wings SET name = ?, tag = ?, description = ? WHERE id = ?'
);
const deleteWingStmt = db.prepare('DELETE FROM wings WHERE id = ?');
const selectWingByToken = db.prepare('SELECT * FROM wings WHERE ingest_token = ?');
const setWingTokenStmt = db.prepare('UPDATE wings SET ingest_token = ? WHERE id = ?');

export function createWing({ name, tag, description }) {
  const info = insertWing.run(name, tag ?? null, description ?? null, Date.now());
  return getWing(Number(info.lastInsertRowid));
}
export function getWings() {
  return selectWings.all();
}
export function getWing(id) {
  return selectWing.get(id) || null;
}
export function updateWing(id, { name, tag, description }) {
  updateWingStmt.run(name, tag ?? null, description ?? null, id);
  return getWing(id);
}
export function deleteWing(id) {
  return deleteWingStmt.run(id).changes;
}
export function getWingByIngestToken(token) {
  if (!token) return null;
  return selectWingByToken.get(token) || null;
}
export function getWingIngestToken(id) {
  const w = getWing(id);
  if (!w) return null;
  if (!w.ingest_token) {
    const token = randomBytes(24).toString('hex');
    setWingTokenStmt.run(token, id);
    return token;
  }
  return w.ingest_token;
}
export function regenerateWingIngestToken(id) {
  const token = randomBytes(24).toString('hex');
  setWingTokenStmt.run(token, id);
  return token;
}

const setWingOpsBotStmt = db.prepare(
  'UPDATE wings SET ops_bot_url = ?, ops_bot_token = ? WHERE id = ?'
);
export function setWingOpsBot(id, { ops_bot_url, ops_bot_token }) {
  setWingOpsBotStmt.run(
    ops_bot_url ? String(ops_bot_url).slice(0, 500) : null,
    ops_bot_token ? String(ops_bot_token).slice(0, 200) : null,
    id
  );
  return getWing(id);
}

// ---------------------------------------------------------------------------
// Squadrons
// ---------------------------------------------------------------------------
const insertSquadron = db.prepare(`
  INSERT INTO squadrons (wing_id, name, tag, aircraft, description, sort_order, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);
const selectSquadronsByWing = db.prepare(
  'SELECT * FROM squadrons WHERE wing_id = ? ORDER BY sort_order ASC, name ASC'
);
const selectSquadron = db.prepare('SELECT * FROM squadrons WHERE id = ?');
const updateSquadronStmt = db.prepare(`
  UPDATE squadrons SET name = ?, tag = ?, aircraft = ?, description = ?, sort_order = ?
  WHERE id = ?
`);
const deleteSquadronStmt = db.prepare('DELETE FROM squadrons WHERE id = ?');
const countMembersInSquadron = db.prepare(
  "SELECT COUNT(*) AS n FROM members WHERE squadron_id = ? AND status != 'retired'"
);

export function createSquadron(wingId, { name, tag, aircraft, description, sort_order }) {
  const info = insertSquadron.run(
    wingId,
    name,
    tag ?? null,
    aircraft ?? null,
    description ?? null,
    Number(sort_order) || 0,
    Date.now()
  );
  return getSquadron(Number(info.lastInsertRowid));
}
export function getSquadrons(wingId) {
  return selectSquadronsByWing.all(wingId).map((s) => ({
    ...s,
    member_count: countMembersInSquadron.get(s.id).n,
  }));
}
export function getSquadron(id) {
  return selectSquadron.get(id) || null;
}
export function updateSquadron(id, { name, tag, aircraft, description, sort_order }) {
  updateSquadronStmt.run(
    name,
    tag ?? null,
    aircraft ?? null,
    description ?? null,
    Number(sort_order) || 0,
    id
  );
  return getSquadron(id);
}
export function deleteSquadron(id) {
  return deleteSquadronStmt.run(id).changes;
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------
const MEMBER_FIELDS =
  'wing_id, squadron_id, discord_user_id, callsign, name, rank, billet, airframes, status, app_role, notes, joined_at, modex, subdivision';
const insertMember = db.prepare(`
  INSERT INTO members (${MEMBER_FIELDS}, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const selectMember = db.prepare('SELECT * FROM members WHERE id = ?');
const selectMembersByWing = db.prepare(
  'SELECT * FROM members WHERE wing_id = ? ORDER BY callsign ASC, name ASC'
);
const selectMembersBySquadron = db.prepare(
  'SELECT * FROM members WHERE squadron_id = ? ORDER BY callsign ASC, name ASC'
);
const selectMemberByDiscord = db.prepare(
  'SELECT * FROM members WHERE discord_user_id = ?'
);
const updateMemberStmt = db.prepare(`
  UPDATE members SET squadron_id = ?, discord_user_id = ?, callsign = ?, name = ?,
    rank = ?, billet = ?, airframes = ?, status = ?, app_role = ?, notes = ?,
    joined_at = ?, modex = ?, subdivision = ?, updated_at = ?
  WHERE id = ?
`);
const deleteMemberStmt = db.prepare('DELETE FROM members WHERE id = ?');

const normMember = (d) => ({
  squadron_id: d.squadron_id ?? null,
  discord_user_id: d.discord_user_id ? String(d.discord_user_id) : null,
  callsign: d.callsign ?? null,
  name: d.name ?? null,
  rank: d.rank ?? null,
  billet: d.billet ?? null,
  airframes: d.airframes ?? null,
  status: d.status || 'active',
  app_role: ['admin', 'commander', 'member'].includes(d.app_role) ? d.app_role : 'member',
  notes: d.notes ?? null,
  joined_at: Number.isFinite(d.joined_at) ? d.joined_at : null,
  modex: d.modex != null && String(d.modex) !== '' ? String(d.modex).slice(0, 12) : null,
  subdivision: ['main', 'ready_reserve', 'candidate', 'frs'].includes(d.subdivision) ? d.subdivision : 'main',
});

export function createMember(wingId, d) {
  const m = normMember(d);
  const now = Date.now();
  const info = insertMember.run(
    wingId, m.squadron_id, m.discord_user_id, m.callsign, m.name, m.rank, m.billet,
    m.airframes, m.status, m.app_role, m.notes, m.joined_at, m.modex, m.subdivision, now, now
  );
  return getMember(Number(info.lastInsertRowid));
}
export function getMember(id) {
  return selectMember.get(id) || null;
}
export function getMembersByWing(wingId) {
  return selectMembersByWing.all(wingId);
}
export function getMembersBySquadron(squadronId) {
  return selectMembersBySquadron.all(squadronId);
}
export function getMemberByDiscord(discordId) {
  if (!discordId) return null;
  return selectMemberByDiscord.get(String(discordId)) || null;
}
export function updateMember(id, d) {
  const m = normMember(d);
  updateMemberStmt.run(
    m.squadron_id, m.discord_user_id, m.callsign, m.name, m.rank, m.billet,
    m.airframes, m.status, m.app_role, m.notes, m.joined_at, m.modex, m.subdivision, Date.now(), id
  );
  return getMember(id);
}
export function deleteMember(id) {
  return deleteMemberStmt.run(id).changes;
}

// ---------------------------------------------------------------------------
// Pilot aliases (identity bridge)
// ---------------------------------------------------------------------------
const insertAlias = db.prepare(
  'INSERT INTO pilot_aliases (member_id, alias, created_at) VALUES (?, ?, ?)'
);
const selectAliasesByMember = db.prepare(
  'SELECT * FROM pilot_aliases WHERE member_id = ? ORDER BY alias ASC'
);
const selectAlias = db.prepare('SELECT * FROM pilot_aliases WHERE id = ?');
const selectAliasByName = db.prepare('SELECT * FROM pilot_aliases WHERE alias = ?');
const deleteAliasStmt = db.prepare('DELETE FROM pilot_aliases WHERE id = ?');

export function addAlias(memberId, alias) {
  const clean = String(alias || '').trim();
  if (!clean) throw new Error('empty_alias');
  const existing = selectAliasByName.get(clean);
  if (existing) {
    if (existing.member_id === memberId) return existing;
    throw new Error('alias_taken');
  }
  const info = insertAlias.run(memberId, clean, Date.now());
  return selectAlias.get(Number(info.lastInsertRowid));
}
export function getAliases(memberId) {
  return selectAliasesByMember.all(memberId);
}
export function getAlias(id) {
  return selectAlias.get(id) || null;
}
export function resolveAlias(alias) {
  const row = selectAliasByName.get(String(alias || '').trim());
  return row ? row.member_id : null;
}
export function deleteAlias(id) {
  return deleteAliasStmt.run(id).changes;
}

// ---------------------------------------------------------------------------
// Qualifications
// ---------------------------------------------------------------------------
const insertQual = db.prepare(`
  INSERT INTO quals (wing_id, code, name, category, description, sort_order, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);
const selectQualsByWing = db.prepare(
  'SELECT * FROM quals WHERE wing_id = ? ORDER BY sort_order ASC, code ASC'
);
const selectQual = db.prepare('SELECT * FROM quals WHERE id = ?');
const deleteQualStmt = db.prepare('DELETE FROM quals WHERE id = ?');

export function createQual(wingId, { code, name, category, description, sort_order }) {
  const info = insertQual.run(
    wingId,
    String(code).trim(),
    String(name).trim(),
    category ?? null,
    description ?? null,
    Number(sort_order) || 0,
    Date.now()
  );
  return selectQual.get(Number(info.lastInsertRowid));
}
export function getQuals(wingId) {
  return selectQualsByWing.all(wingId);
}
export function getQual(id) {
  return selectQual.get(id) || null;
}
export function deleteQual(id) {
  return deleteQualStmt.run(id).changes;
}

const upsertMemberQual = db.prepare(`
  INSERT INTO member_quals (member_id, qual_id, status, awarded_at, expires_at, notes, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(member_id, qual_id) DO UPDATE SET
    status = excluded.status, awarded_at = excluded.awarded_at,
    expires_at = excluded.expires_at, notes = excluded.notes, updated_at = excluded.updated_at
`);
const selectMemberQuals = db.prepare(`
  SELECT mq.*, q.code, q.name, q.category
  FROM member_quals mq JOIN quals q ON q.id = mq.qual_id
  WHERE mq.member_id = ? ORDER BY q.sort_order ASC, q.code ASC
`);
const deleteMemberQualStmt = db.prepare(
  'DELETE FROM member_quals WHERE member_id = ? AND qual_id = ?'
);

export function setMemberQual(memberId, qualId, { status, awarded_at, expires_at, notes }) {
  upsertMemberQual.run(
    memberId,
    qualId,
    ['qualified', 'training', 'expired'].includes(status) ? status : 'qualified',
    Number.isFinite(awarded_at) ? awarded_at : null,
    Number.isFinite(expires_at) ? expires_at : null,
    notes ?? null,
    Date.now()
  );
  return selectMemberQuals.all(memberId);
}
export function getMemberQuals(memberId) {
  return selectMemberQuals.all(memberId);
}
export function removeMemberQual(memberId, qualId) {
  return deleteMemberQualStmt.run(memberId, qualId).changes;
}

// ---------------------------------------------------------------------------
// Sorties (ingest target; attributed via alias map)
// ---------------------------------------------------------------------------
const insertSortie = db.prepare(`
  INSERT INTO sorties (wing_id, member_id, alias, airframe, seconds, source, started_at, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
const selectRecentSortiesByWing = db.prepare(
  'SELECT * FROM sorties WHERE wing_id = ? ORDER BY created_at DESC LIMIT ?'
);
const selectSortiesByMember = db.prepare(
  'SELECT * FROM sorties WHERE member_id = ? ORDER BY created_at DESC LIMIT ?'
);
const selectUnmatchedAliases = db.prepare(`
  SELECT alias, COUNT(*) AS sorties, MAX(created_at) AS last_seen
  FROM sorties WHERE wing_id = ? AND member_id IS NULL
  GROUP BY alias ORDER BY last_seen DESC LIMIT 200
`);
const relinkSortiesStmt = db.prepare(
  'UPDATE sorties SET member_id = ? WHERE alias = ? AND member_id IS NULL'
);

export function addSortie(wingId, { alias, airframe, seconds, source, started_at }) {
  const cleanAlias = String(alias || '').trim();
  if (!cleanAlias) throw new Error('empty_alias');
  const memberId = resolveAlias(cleanAlias);
  const info = insertSortie.run(
    wingId,
    memberId,
    cleanAlias,
    airframe ?? null,
    Math.max(0, Number(seconds) || 0),
    source ?? null,
    Number.isFinite(started_at) ? started_at : null,
    Date.now()
  );
  return Number(info.lastInsertRowid);
}
export function getRecentSorties(wingId, limit = 50) {
  return selectRecentSortiesByWing.all(wingId, limit);
}
export function getMemberSorties(memberId, limit = 50) {
  return selectSortiesByMember.all(memberId, limit);
}
export function getUnmatchedAliases(wingId) {
  return selectUnmatchedAliases.all(wingId);
}
// When an alias is newly claimed, back-fill any prior unmatched sorties.
export function relinkSortiesForAlias(alias, memberId) {
  return relinkSortiesStmt.run(memberId, String(alias).trim()).changes;
}

export { safeParse };
export default db;
