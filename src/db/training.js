/**
 * Training sessions — discrete instructor-pilot training events, separate
 * from quals/activities/events.
 *
 * The Deckboss reference review surfaced this as a distinct entity: an
 * instructor sat down with a pilot, here's the duration, what they covered.
 * Sortie hours (from the DCS hook) are passive flight time. Training sessions
 * are deliberate instruction time.
 */

import db from './index.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS training_sessions (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    wing_id               INTEGER NOT NULL REFERENCES wings(id) ON DELETE CASCADE,
    pilot_member_id       INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    instructor_member_id  INTEGER REFERENCES members(id) ON DELETE SET NULL,
    qual_id               INTEGER REFERENCES quals(id) ON DELETE SET NULL,
    started_at            INTEGER NOT NULL,
    duration_minutes      INTEGER NOT NULL DEFAULT 0,
    topics                TEXT,
    notes                 TEXT,
    created_by            TEXT,
    created_at            INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_train_wing_started ON training_sessions (wing_id, started_at);
  CREATE INDEX IF NOT EXISTS idx_train_pilot ON training_sessions (pilot_member_id, started_at);
  CREATE INDEX IF NOT EXISTS idx_train_instructor ON training_sessions (instructor_member_id, started_at);
`);

const str = (v, n) => (v == null || v === '' ? null : String(v).slice(0, n));

const insertSessionStmt = db.prepare(`
  INSERT INTO training_sessions
    (wing_id, pilot_member_id, instructor_member_id, qual_id,
     started_at, duration_minutes, topics, notes, created_by, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const selectSessionStmt = db.prepare('SELECT * FROM training_sessions WHERE id = ?');
const deleteSessionStmt = db.prepare('DELETE FROM training_sessions WHERE id = ?');
const updateSessionStmt = db.prepare(`
  UPDATE training_sessions SET
    pilot_member_id = ?, instructor_member_id = ?, qual_id = ?,
    started_at = ?, duration_minutes = ?, topics = ?, notes = ?
  WHERE id = ?
`);

export function createTrainingSession(wingId, d, createdBy) {
  if (!d.pilot_member_id) throw new Error('missing_pilot');
  if (!Number.isFinite(Number(d.started_at)) || !Number.isFinite(Number(d.duration_minutes))) {
    throw new Error('bad_time');
  }
  const now = Date.now();
  const r = insertSessionStmt.run(
    wingId,
    Number(d.pilot_member_id),
    d.instructor_member_id ? Number(d.instructor_member_id) : null,
    d.qual_id ? Number(d.qual_id) : null,
    Number(d.started_at),
    Math.max(0, Math.floor(Number(d.duration_minutes))),
    str(d.topics, 500),
    str(d.notes, 4000),
    createdBy || null,
    now,
  );
  return getTrainingSession(Number(r.lastInsertRowid));
}

export function getTrainingSession(id) {
  return selectSessionStmt.get(id) || null;
}

export function updateTrainingSession(id, d) {
  const cur = getTrainingSession(id);
  if (!cur) return null;
  updateSessionStmt.run(
    d.pilot_member_id !== undefined ? Number(d.pilot_member_id) : cur.pilot_member_id,
    d.instructor_member_id !== undefined ? (d.instructor_member_id ? Number(d.instructor_member_id) : null) : cur.instructor_member_id,
    d.qual_id !== undefined ? (d.qual_id ? Number(d.qual_id) : null) : cur.qual_id,
    d.started_at !== undefined ? Number(d.started_at) : cur.started_at,
    d.duration_minutes !== undefined ? Math.max(0, Math.floor(Number(d.duration_minutes))) : cur.duration_minutes,
    d.topics !== undefined ? str(d.topics, 500) : cur.topics,
    d.notes !== undefined ? str(d.notes, 4000) : cur.notes,
    id,
  );
  return getTrainingSession(id);
}

export function deleteTrainingSession(id) {
  return deleteSessionStmt.run(id).changes;
}

const selectSessionsByPilotStmt = db.prepare(`
  SELECT ts.*, im.callsign AS instructor_callsign, im.name AS instructor_name,
         q.code AS qual_code, q.name AS qual_name
  FROM training_sessions ts
  LEFT JOIN members im ON im.id = ts.instructor_member_id
  LEFT JOIN quals q ON q.id = ts.qual_id
  WHERE ts.pilot_member_id = ?
  ORDER BY ts.started_at DESC
  LIMIT ?
`);
export function getSessionsByPilot(memberId, limit = 50) {
  return selectSessionsByPilotStmt.all(memberId, limit);
}

const selectSessionsByInstructorStmt = db.prepare(`
  SELECT ts.*, pm.callsign AS pilot_callsign, pm.name AS pilot_name, pm.modex AS pilot_modex,
         q.code AS qual_code
  FROM training_sessions ts
  LEFT JOIN members pm ON pm.id = ts.pilot_member_id
  LEFT JOIN quals q ON q.id = ts.qual_id
  WHERE ts.instructor_member_id = ?
  ORDER BY ts.started_at DESC
  LIMIT ?
`);
export function getSessionsByInstructor(memberId, limit = 50) {
  return selectSessionsByInstructorStmt.all(memberId, limit);
}

// Per-pilot rollup for the IP Training Dashboard. One row per active pilot
// with session count + hours + last session timestamp. Pilots with zero
// sessions are included so the dashboard shows the whole roster.
const selectTrainingSummaryStmt = db.prepare(`
  SELECT
    m.id, m.rank, m.callsign, m.name, m.modex, m.subdivision, m.squadron_id,
    sq.tag AS sqn_tag,
    COALESCE(ts.session_count, 0)   AS sessions,
    COALESCE(ts.total_minutes, 0)   AS total_minutes,
    ts.last_session_at
  FROM members m
  LEFT JOIN squadrons sq ON sq.id = m.squadron_id
  LEFT JOIN (
    SELECT pilot_member_id,
           COUNT(*)        AS session_count,
           SUM(duration_minutes) AS total_minutes,
           MAX(started_at) AS last_session_at
    FROM training_sessions
    WHERE wing_id = ?
    GROUP BY pilot_member_id
  ) ts ON ts.pilot_member_id = m.id
  WHERE m.wing_id = ? AND m.status = 'active'
  ORDER BY m.subdivision, m.modex
`);
export function getTrainingSummary(wingId) {
  return selectTrainingSummaryStmt.all(wingId, wingId).map((r) => ({
    ...r,
    total_hours: Math.round((r.total_minutes || 0) / 60 * 10) / 10,
  }));
}
