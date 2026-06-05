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

// --- Phase 2: qual classifier flags + assignment deadline ---
// is_basic    — auto-assigned to every new pilot on join (e.g. IQT for fresh students)
// is_currency — has expiration; renews via Currency Status dashboard
// is_wing_wide — visible across all squadrons (vs. squadron-scoped). Default 1 for backwards compat.
// completion_deadline_days — N days from assignment to complete; null = no deadline
ensureColumn('quals', 'is_basic', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('quals', 'is_currency', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('quals', 'is_wing_wide', 'INTEGER NOT NULL DEFAULT 1');
ensureColumn('quals', 'completion_deadline_days', 'INTEGER');

// --- Epic 5b: Ops Bot publish bridge (Discord event embeds) ---
ensureColumn('wings', 'ops_bot_url', 'TEXT');     // base URL of the Ops Bot (e.g. https://dcsoptbot-production-0c4b.up.railway.app)
ensureColumn('wings', 'ops_bot_token', 'TEXT');   // per-guild outbound token revealed by the Ops Bot dashboard

// --- Phase 3.3: multi-crew qualification tracks ---
// Quals can optionally have crew-position tracks (e.g. F-14B IQT has pilot
// and RIO tracks). A qual with 0 tracks defined is treated as single-seat.
// member_quals.track stores which track this pilot is on for this qual
// (NULL = single-seat / not applicable).
db.exec(`
  CREATE TABLE IF NOT EXISTS qual_tracks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    qual_id    INTEGER NOT NULL REFERENCES quals(id) ON DELETE CASCADE,
    code       TEXT NOT NULL,
    label      TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_qual_tracks_unique ON qual_tracks (qual_id, code);
`);
ensureColumn('member_quals', 'track', 'TEXT');

// --- Phase 3: modex pools per subdivision ---
// Each subdivision (main/ready_reserve/candidate/frs) on a wing can have an
// allocated modex range. When admins create new pilots, the "Available: N"
// hint on the Personnel page reads from these pools to show the next free
// number in the relevant subdivision. Pools are optional — wings without
// them just don't get the hint.
db.exec(`
  CREATE TABLE IF NOT EXISTS modex_pools (
    wing_id     INTEGER NOT NULL REFERENCES wings(id) ON DELETE CASCADE,
    subdivision TEXT NOT NULL,
    range_start INTEGER NOT NULL,
    range_end   INTEGER NOT NULL,
    notes       TEXT,
    PRIMARY KEY (wing_id, subdivision)
  );
`);

// --- Epic 7: access levels (capability tags) ---
// Comma-separated tags. Standard set: JTAC, GM, ATC, LSO, IP, AWACS, FAC.
// Independent of app_role (member|commander|admin) which is the auth tier.
ensureColumn('members', 'capabilities', 'TEXT');

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

// SECURITY: wings the given Discord user has access to via roster membership.
// Used by GET /api/wings to prevent multi-tenant data leakage — without this
// filter, every logged-in user saw every wing because activeWing = wings[0]
// in the dashboard. Root admins (config.rootAdminIds) bypass this via the
// caller; this only returns membership-derived rows.
const selectWingsForMemberStmt = db.prepare(`
  SELECT DISTINCT w.* FROM wings w
  JOIN members m ON m.wing_id = w.id
  WHERE m.discord_user_id = ?
  ORDER BY w.id ASC
`);
export function getWingsForUser(discordUserId) {
  if (!discordUserId) return [];
  return selectWingsForMemberStmt.all(String(discordUserId));
}

// Cheap membership probe — used by the access guard middleware.
const checkWingMembershipStmt = db.prepare(
  'SELECT 1 FROM members WHERE wing_id = ? AND discord_user_id = ? LIMIT 1'
);
export function userHasWingAccess(discordUserId, wingId) {
  if (!discordUserId || !wingId) return false;
  return !!checkWingMembershipStmt.get(Number(wingId), String(discordUserId));
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
  'wing_id, squadron_id, discord_user_id, callsign, name, rank, billet, airframes, status, app_role, notes, joined_at, modex, subdivision, capabilities';
const insertMember = db.prepare(`
  INSERT INTO members (${MEMBER_FIELDS}, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    joined_at = ?, modex = ?, subdivision = ?, capabilities = ?, updated_at = ?
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
  capabilities: normCapabilities(d.capabilities),
});

// Accepts a CSV string, an array of strings, or null. Returns CSV (or null).
// Caps each tag at 16 chars, max 8 tags. Tags are uppercased and trimmed.
function normCapabilities(v) {
  if (v == null || v === '') return null;
  const list = Array.isArray(v) ? v : String(v).split(',');
  const tags = list.map((t) => String(t).trim().toUpperCase().slice(0, 16)).filter(Boolean);
  const dedup = [...new Set(tags)].slice(0, 8);
  return dedup.length ? dedup.join(',') : null;
}

export function createMember(wingId, d) {
  const m = normMember(d);
  const now = Date.now();
  const info = insertMember.run(
    wingId, m.squadron_id, m.discord_user_id, m.callsign, m.name, m.rank, m.billet,
    m.airframes, m.status, m.app_role, m.notes, m.joined_at, m.modex, m.subdivision,
    m.capabilities, now, now
  );
  const memberId = Number(info.lastInsertRowid);
  // Auto-assign any "Basic" quals defined for this wing — those are quals the
  // wing has flagged as "every new pilot gets this" (typically IQT / NATOPS).
  // Inserted as status='training' so they show up on the new pilot's My Quals
  // page with progress = 0/N.
  try { autoAssignBasicQuals(wingId, memberId, now); } catch (err) {
    console.warn('[createMember] auto-assign failed:', err.message);
  }
  return getMember(memberId);
}

const selectBasicQualsStmt = db.prepare(
  'SELECT id FROM quals WHERE wing_id = ? AND is_basic = 1'
);
const insertAutoMemberQualStmt = db.prepare(
  `INSERT OR IGNORE INTO member_quals (member_id, qual_id, status, updated_at)
   VALUES (?, ?, 'training', ?)`
);
function autoAssignBasicQuals(wingId, memberId, now) {
  for (const q of selectBasicQualsStmt.all(wingId)) {
    insertAutoMemberQualStmt.run(memberId, q.id, now);
  }
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
    m.airframes, m.status, m.app_role, m.notes, m.joined_at, m.modex, m.subdivision,
    m.capabilities, Date.now(), id
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
// Qualification crew-position tracks (Phase 3.3)
// ---------------------------------------------------------------------------
const selectTracksStmt = db.prepare('SELECT * FROM qual_tracks WHERE qual_id = ? ORDER BY sort_order ASC, code ASC');
const insertTrackStmt = db.prepare(
  'INSERT INTO qual_tracks (qual_id, code, label, sort_order) VALUES (?, ?, ?, ?)'
);
const deleteTrackStmt = db.prepare('DELETE FROM qual_tracks WHERE id = ?');

export function getQualTracks(qualId) {
  return selectTracksStmt.all(qualId);
}

export function createQualTrack(qualId, { code, label, sort_order }) {
  if (!code || !label) throw new Error('missing_fields');
  try {
    const r = insertTrackStmt.run(
      qualId,
      String(code).trim().slice(0, 20),
      String(label).trim().slice(0, 60),
      Number(sort_order) || 0,
    );
    return selectTracksStmt.all(qualId).find((t) => t.id === Number(r.lastInsertRowid));
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) throw new Error('duplicate_code');
    throw err;
  }
}

export function deleteQualTrack(id) {
  return deleteTrackStmt.run(id).changes;
}

// ---------------------------------------------------------------------------
// Modex pools (Phase 3.1)
// ---------------------------------------------------------------------------
const selectPoolsStmt = db.prepare('SELECT * FROM modex_pools WHERE wing_id = ? ORDER BY range_start ASC');
const upsertPoolStmt = db.prepare(`
  INSERT INTO modex_pools (wing_id, subdivision, range_start, range_end, notes)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(wing_id, subdivision) DO UPDATE SET
    range_start = excluded.range_start,
    range_end = excluded.range_end,
    notes = excluded.notes
`);
const deletePoolStmt = db.prepare('DELETE FROM modex_pools WHERE wing_id = ? AND subdivision = ?');
const selectUsedModexStmt = db.prepare(
  `SELECT modex FROM members
   WHERE wing_id = ? AND subdivision = ? AND modex IS NOT NULL AND status != 'retired'`
);

export function getModexPools(wingId) {
  return selectPoolsStmt.all(wingId);
}

export function setModexPool(wingId, subdivision, { range_start, range_end, notes }) {
  if (!Number.isFinite(Number(range_start)) || !Number.isFinite(Number(range_end))) {
    throw new Error('bad_range');
  }
  upsertPoolStmt.run(
    wingId,
    String(subdivision),
    Math.floor(Number(range_start)),
    Math.floor(Number(range_end)),
    notes ? String(notes).slice(0, 200) : null,
  );
  return selectPoolsStmt.all(wingId).find((p) => p.subdivision === subdivision);
}

export function deleteModexPool(wingId, subdivision) {
  return deletePoolStmt.run(wingId, subdivision).changes;
}

// Returns the available modex numbers in this subdivision's pool, capped at
// `limit`. Used by the Personnel/Squadron page header hint.
export function getAvailableModex(wingId, subdivision, limit = 20) {
  const pool = selectPoolsStmt.all(wingId).find((p) => p.subdivision === subdivision);
  if (!pool) return { pool: null, available: [], next: null };
  const used = new Set(selectUsedModexStmt.all(wingId, subdivision)
    .map((r) => String(r.modex).trim())
    .filter(Boolean));
  const available = [];
  for (let n = pool.range_start; n <= pool.range_end && available.length < limit; n++) {
    if (!used.has(String(n))) available.push(n);
  }
  return { pool, available, next: available[0] ?? null };
}

// ---------------------------------------------------------------------------
// Qualifications
// ---------------------------------------------------------------------------
const insertQual = db.prepare(`
  INSERT INTO quals (wing_id, code, name, category, description, sort_order, created_at,
    is_basic, is_currency, is_wing_wide, completion_deadline_days)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const selectQualsByWing = db.prepare(
  'SELECT * FROM quals WHERE wing_id = ? ORDER BY sort_order ASC, code ASC'
);
const selectQual = db.prepare('SELECT * FROM quals WHERE id = ?');
const deleteQualStmt = db.prepare('DELETE FROM quals WHERE id = ?');
const updateQualStmt = db.prepare(`
  UPDATE quals SET code = ?, name = ?, category = ?, description = ?, sort_order = ?,
    is_basic = ?, is_currency = ?, is_wing_wide = ?, completion_deadline_days = ?
  WHERE id = ?
`);

export function createQual(wingId, d) {
  const info = insertQual.run(
    wingId,
    String(d.code).trim(),
    String(d.name).trim(),
    d.category ?? null,
    d.description ?? null,
    Number(d.sort_order) || 0,
    Date.now(),
    d.is_basic ? 1 : 0,
    d.is_currency ? 1 : 0,
    d.is_wing_wide === false ? 0 : 1,
    Number.isFinite(Number(d.completion_deadline_days)) && Number(d.completion_deadline_days) > 0
      ? Number(d.completion_deadline_days) : null,
  );
  return selectQual.get(Number(info.lastInsertRowid));
}

export function updateQual(id, d) {
  const cur = selectQual.get(id);
  if (!cur) return null;
  updateQualStmt.run(
    d.code !== undefined ? String(d.code).trim() : cur.code,
    d.name !== undefined ? String(d.name).trim() : cur.name,
    d.category !== undefined ? d.category : cur.category,
    d.description !== undefined ? d.description : cur.description,
    d.sort_order !== undefined ? (Number(d.sort_order) || 0) : cur.sort_order,
    d.is_basic !== undefined ? (d.is_basic ? 1 : 0) : cur.is_basic,
    d.is_currency !== undefined ? (d.is_currency ? 1 : 0) : cur.is_currency,
    d.is_wing_wide !== undefined ? (d.is_wing_wide ? 1 : 0) : cur.is_wing_wide,
    d.completion_deadline_days !== undefined
      ? (Number.isFinite(Number(d.completion_deadline_days)) && Number(d.completion_deadline_days) > 0
          ? Number(d.completion_deadline_days) : null)
      : cur.completion_deadline_days,
    id,
  );
  return selectQual.get(id);
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

// --- Phase 2: bulk qualification assignment --------------------------------
// Modes:
//   'assign'     — upsert member_quals rows with status='training' (or qualified
//                  if all activities are signed; we keep it simple here and the
//                  auto-qualify path handles graduation)
//   'unassign'   — DELETE the member_qual rows
//   'instructor' — set status='qualified' AND insert/overwrite a special marker
//                  in the notes field so the UI can recognize instructor-tier.
//                  (We don't have a separate "instructor" status enum, so we
//                  encode it in notes with the prefix '[INSTRUCTOR]'.)
const insertBulkAssignStmt = db.prepare(
  `INSERT INTO member_quals (member_id, qual_id, status, updated_at)
   VALUES (?, ?, 'training', ?)
   ON CONFLICT(member_id, qual_id) DO NOTHING`
);
const upsertInstructorStmt = db.prepare(
  `INSERT INTO member_quals (member_id, qual_id, status, awarded_at, notes, updated_at)
   VALUES (?, ?, 'qualified', ?, '[INSTRUCTOR]', ?)
   ON CONFLICT(member_id, qual_id) DO UPDATE SET
     status='qualified', notes='[INSTRUCTOR]', updated_at=excluded.updated_at`
);
const deleteBulkAssignStmt = db.prepare(
  'DELETE FROM member_quals WHERE member_id = ? AND qual_id = ?'
);

export function bulkAssignQuals(qualIds, memberIds, mode = 'assign') {
  const now = Date.now();
  let changed = 0;
  for (const qid of qualIds) {
    for (const mid of memberIds) {
      if (mode === 'unassign') {
        changed += deleteBulkAssignStmt.run(mid, qid).changes;
      } else if (mode === 'instructor') {
        upsertInstructorStmt.run(mid, qid, now, now);
        changed++;
      } else {
        insertBulkAssignStmt.run(mid, qid, now);
        changed++;
      }
    }
  }
  return { changed, mode, qual_count: qualIds.length, member_count: memberIds.length };
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
