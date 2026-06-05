import db, { ensureColumn } from './index.js';

// --- schema -------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS qual_activities (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    qual_id     INTEGER NOT NULL REFERENCES quals(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    group_name  TEXT,
    description TEXT,
    is_currency INTEGER NOT NULL DEFAULT 0,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_qact_qual ON qual_activities (qual_id, sort_order);

  CREATE TABLE IF NOT EXISTS member_activity_signoffs (
    member_id        INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    activity_id      INTEGER NOT NULL REFERENCES qual_activities(id) ON DELETE CASCADE,
    status           TEXT NOT NULL DEFAULT 'signed',  -- signed | instructor
    signer_member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
    signed_at        INTEGER,
    notes            TEXT,
    PRIMARY KEY (member_id, activity_id)
  );
`);

// Cadence on quals: how long to complete; how long currency lasts after qualified.
ensureColumn('quals', 'completion_days', 'INTEGER');
ensureColumn('quals', 'currency_days', 'INTEGER');

const ACT_STATUS = ['signed', 'instructor'];
const DAY = 86400000;

// --- activity CRUD ------------------------------------------------------
const insertActivity = db.prepare(`
  INSERT INTO qual_activities (qual_id, name, group_name, description, is_currency, sort_order, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);
const selectActivitiesByQual = db.prepare(
  'SELECT * FROM qual_activities WHERE qual_id = ? ORDER BY sort_order ASC, id ASC'
);
const selectActivity = db.prepare('SELECT * FROM qual_activities WHERE id = ?');
const updateActivityStmt = db.prepare(
  'UPDATE qual_activities SET name = ?, group_name = ?, description = ?, is_currency = ?, sort_order = ? WHERE id = ?'
);
const deleteActivityStmt = db.prepare('DELETE FROM qual_activities WHERE id = ?');

const normAct = (d) => ({
  name: String(d.name || '').slice(0, 200),
  group_name: d.group_name ? String(d.group_name).slice(0, 80) : null,
  description: d.description ? String(d.description).slice(0, 2000) : null,
  is_currency: d.is_currency ? 1 : 0,
  sort_order: Number(d.sort_order) || 0,
});

export function createActivity(qualId, d) {
  const a = normAct(d);
  const info = insertActivity.run(qualId, a.name, a.group_name, a.description, a.is_currency, a.sort_order, Date.now());
  return selectActivity.get(Number(info.lastInsertRowid));
}
export function getActivities(qualId) {
  return selectActivitiesByQual.all(qualId);
}
export function getActivity(id) {
  return selectActivity.get(id) || null;
}
export function updateActivity(id, d) {
  const a = normAct(d);
  updateActivityStmt.run(a.name, a.group_name, a.description, a.is_currency, a.sort_order, id);
  return selectActivity.get(id);
}
export function deleteActivity(id) {
  return deleteActivityStmt.run(id).changes;
}

// --- sign-offs ----------------------------------------------------------
const upsertSignoff = db.prepare(`
  INSERT INTO member_activity_signoffs (member_id, activity_id, status, signer_member_id, signed_at, notes)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(member_id, activity_id) DO UPDATE SET
    status = excluded.status, signer_member_id = excluded.signer_member_id,
    signed_at = excluded.signed_at, notes = excluded.notes
`);
const deleteSignoffStmt = db.prepare(
  'DELETE FROM member_activity_signoffs WHERE member_id = ? AND activity_id = ?'
);

export function signOffActivity(memberId, activityId, { status, signerId, notes } = {}) {
  upsertSignoff.run(
    memberId, activityId,
    ACT_STATUS.includes(status) ? status : 'signed',
    signerId || null, Date.now(), notes || null
  );
  const act = selectActivity.get(activityId);
  if (act) tryAutoQualify(memberId, act.qual_id);
}
// Bulk sign-off across (activities × members). Mode = 'signed' (default
// upsert), 'reset' (delete signoffs), or 'instructor' (mark with status
// 'instructor' which is a richer tier — see ACT_STATUS).
export function bulkSignOff(activityIds, memberIds, mode = 'signed', signerId = null) {
  const now = Date.now();
  let changed = 0;
  const qualIds = new Set();
  for (const aid of activityIds) {
    const act = selectActivity.get(aid);
    if (act) qualIds.add(act.qual_id);
    for (const mid of memberIds) {
      if (mode === 'reset') {
        changed += deleteSignoffStmt.run(mid, aid).changes;
      } else {
        const status = mode === 'instructor' && ACT_STATUS.includes('instructor') ? 'instructor' : 'signed';
        upsertSignoff.run(mid, aid, status, signerId || null, now, null);
        changed++;
      }
    }
  }
  // Roll forward member_quals to 'qualified' wherever every activity is signed.
  for (const qid of qualIds) {
    for (const mid of memberIds) tryAutoQualify(mid, qid);
  }
  return { changed, mode, activity_count: activityIds.length, member_count: memberIds.length };
}

export function removeSignoff(memberId, activityId) {
  const r = deleteSignoffStmt.run(memberId, activityId).changes;
  // Note: we don't demote member_quals here — admins can re-qualify manually.
  return r;
}

// activities for one member+qual, joined with signoff status
const selectMemberActivitiesForQual = db.prepare(`
  SELECT a.id AS activity_id, a.name, a.group_name, a.is_currency, a.sort_order, a.description,
         s.status AS signoff_status, s.signed_at, s.signer_member_id
  FROM qual_activities a
  LEFT JOIN member_activity_signoffs s ON s.activity_id = a.id AND s.member_id = ?
  WHERE a.qual_id = ?
  ORDER BY a.sort_order ASC, a.id ASC
`);
export function getMemberActivitiesForQual(memberId, qualId) {
  return selectMemberActivitiesForQual.all(memberId, qualId);
}

// --- auto-qualify when all activities for a qual are signed -------------
const selectQualById = db.prepare('SELECT * FROM quals WHERE id = ?');
const upsertMemberQual = db.prepare(`
  INSERT INTO member_quals (member_id, qual_id, status, awarded_at, expires_at, notes, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(member_id, qual_id) DO UPDATE SET
    status = excluded.status, awarded_at = excluded.awarded_at,
    expires_at = excluded.expires_at, updated_at = excluded.updated_at
`);
const countUnsigned = db.prepare(`
  SELECT COUNT(*) AS n FROM qual_activities a
  LEFT JOIN member_activity_signoffs s ON s.activity_id = a.id AND s.member_id = ?
  WHERE a.qual_id = ? AND s.member_id IS NULL
`);
const countActivities = db.prepare('SELECT COUNT(*) AS n FROM qual_activities WHERE qual_id = ?');

const selectExistingMemberQual = db.prepare(
  'SELECT status FROM member_quals WHERE member_id = ? AND qual_id = ?'
);

function tryAutoQualify(memberId, qualId) {
  const total = countActivities.get(qualId).n;
  if (!total) return; // no activities -> nothing to derive
  const unsigned = countUnsigned.get(memberId, qualId).n;
  const signed = total - unsigned;
  const qual = selectQualById.get(qualId);
  const now = Date.now();
  if (unsigned === 0) {
    const expires_at = qual.currency_days ? now + qual.currency_days * DAY : null;
    upsertMemberQual.run(memberId, qualId, 'qualified', now, expires_at, null, now);
  } else if (signed > 0) {
    // Partial — make sure a "training" row exists, but don't demote a manually-qualified state.
    if (!selectExistingMemberQual.get(memberId, qualId)) {
      upsertMemberQual.run(memberId, qualId, 'training', null, null, null, now);
    }
  }
}

// member_qual progress for a single qual
export function getMemberQualProgress(memberId, qualId) {
  const total = countActivities.get(qualId).n;
  const unsigned = total ? countUnsigned.get(memberId, qualId).n : 0;
  return { total, signed: total - unsigned, qualified: total > 0 && unsigned === 0 };
}

// --- cadence (completion_days / currency_days) --------------------------
const setQualCadenceStmt = db.prepare(
  'UPDATE quals SET completion_days = ?, currency_days = ? WHERE id = ?'
);
export function setQualCadence(qualId, { completion_days, currency_days }) {
  setQualCadenceStmt.run(
    Number.isFinite(completion_days) ? completion_days : null,
    Number.isFinite(currency_days) ? currency_days : null,
    qualId
  );
}

// --- currency status ----------------------------------------------------
function currencyStatus(row) {
  if (!row.expires_at) return { status: 'current', days_remaining: null };
  const ms = row.expires_at - Date.now();
  const days = Math.ceil(ms / DAY);
  if (ms < 0) return { status: 'expired', days_remaining: days };
  if (ms < 14 * DAY) return { status: 'expiring', days_remaining: days };
  return { status: 'current', days_remaining: days };
}

const selectWingCurrency = db.prepare(`
  SELECT mq.member_id, mq.qual_id, mq.status AS qual_status, mq.awarded_at, mq.expires_at,
         m.callsign, m.modex, m.squadron_id, sq.tag AS sqn_tag,
         q.code, q.name AS qual_name, q.currency_days
  FROM member_quals mq
  JOIN members m ON m.id = mq.member_id
  LEFT JOIN squadrons sq ON sq.id = m.squadron_id
  JOIN quals q ON q.id = mq.qual_id
  WHERE q.wing_id = ? AND m.status != 'retired'
    AND mq.status = 'qualified' AND mq.expires_at IS NOT NULL
  ORDER BY mq.expires_at ASC
`);

export function getWingCurrency(wingId) {
  return selectWingCurrency.all(wingId).map((r) => ({ ...r, ...currencyStatus(r) }));
}

// --- training board (pilots × activities matrix) ------------------------
const selectWingMembersOrdered = db.prepare(`
  SELECT m.id, m.callsign, m.name, m.modex, m.subdivision, m.squadron_id, sq.tag AS sqn_tag
  FROM members m LEFT JOIN squadrons sq ON sq.id = m.squadron_id
  WHERE m.wing_id = ? AND m.status != 'retired'
  ORDER BY sq.id ASC, m.modex ASC, m.callsign ASC
`);
const selectSquadronMembersOrdered = db.prepare(`
  SELECT id, callsign, name, modex, subdivision, squadron_id, NULL AS sqn_tag
  FROM members WHERE squadron_id = ? AND status != 'retired'
  ORDER BY modex ASC, callsign ASC
`);
const selectQualSignoffs = db.prepare(`
  SELECT s.member_id, s.activity_id, s.status FROM member_activity_signoffs s
  JOIN qual_activities a ON a.id = s.activity_id WHERE a.qual_id = ?
`);

export function getTrainingBoard(qualId, { squadronId } = {}) {
  const qual = selectQualById.get(qualId);
  if (!qual) return null;
  const activities = getActivities(qualId);
  const members = squadronId
    ? selectSquadronMembersOrdered.all(squadronId)
    : selectWingMembersOrdered.all(qual.wing_id);
  const so = selectQualSignoffs.all(qualId);
  const key = (m, a) => `${m}:${a}`;
  const byKey = new Map(so.map((s) => [key(s.member_id, s.activity_id), s.status]));
  // cells[row=activity][col=member] = status|null
  const cells = activities.map((a) => members.map((m) => byKey.get(key(m.id, a.id)) || null));
  return { qual, activities, members, cells };
}
