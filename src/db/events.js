import db from './index.js';

// --- schema -------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    wing_id             INTEGER NOT NULL REFERENCES wings(id) ON DELETE CASCADE,
    squadron_id         INTEGER REFERENCES squadrons(id) ON DELETE SET NULL,
    title               TEXT NOT NULL,
    description         TEXT,
    kind                TEXT NOT NULL DEFAULT 'squadron',  -- squadron | extra_credit
    start_at            INTEGER NOT NULL,
    end_at              INTEGER,
    multi_squadron      INTEGER NOT NULL DEFAULT 0,
    track_attendance    INTEGER NOT NULL DEFAULT 1,
    discord_channel_id  TEXT,
    discord_message_id  TEXT,
    created_by          TEXT,
    created_at          INTEGER NOT NULL,
    updated_at          INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_events_wing_start ON events (wing_id, start_at);
  CREATE INDEX IF NOT EXISTS idx_events_sqn ON events (squadron_id, start_at);

  CREATE TABLE IF NOT EXISTS event_attendance (
    event_id     INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    member_id    INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    status       TEXT NOT NULL,   -- present | absent | excused | extra_credit | ua
    recorded_by  TEXT,
    recorded_at  INTEGER,
    notes        TEXT,
    PRIMARY KEY (event_id, member_id)
  );
  CREATE INDEX IF NOT EXISTS idx_attend_member ON event_attendance (member_id);

  CREATE TABLE IF NOT EXISTS event_squadron_access (
    event_id    INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    squadron_id INTEGER NOT NULL REFERENCES squadrons(id) ON DELETE CASCADE,
    role        TEXT NOT NULL DEFAULT 'invited',  -- host | invited
    PRIMARY KEY (event_id, squadron_id)
  );

  CREATE TABLE IF NOT EXISTS loa_requests (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id   INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    start_at    INTEGER NOT NULL,
    end_at      INTEGER NOT NULL,
    reason      TEXT,
    status      TEXT NOT NULL DEFAULT 'requested',  -- requested | approved | denied
    approved_by TEXT,
    approved_at INTEGER,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_loa_member ON loa_requests (member_id, start_at);
`);

const EVENT_KINDS = ['squadron', 'extra_credit'];
const ATTEND_STATUS = ['present', 'absent', 'excused', 'extra_credit', 'ua'];
const LOA_STATUS = ['requested', 'approved', 'denied'];

// --- events CRUD --------------------------------------------------------
const insertEvent = db.prepare(`
  INSERT INTO events (wing_id, squadron_id, title, description, kind, start_at, end_at,
    multi_squadron, track_attendance, created_by, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const selectEvent = db.prepare('SELECT * FROM events WHERE id = ?');
const updateEventStmt = db.prepare(`
  UPDATE events SET squadron_id = ?, title = ?, description = ?, kind = ?,
    start_at = ?, end_at = ?, multi_squadron = ?, track_attendance = ?,
    updated_at = ?
  WHERE id = ?
`);
const deleteEventStmt = db.prepare('DELETE FROM events WHERE id = ?');

const normEvent = (d) => ({
  squadron_id: d.squadron_id ? Number(d.squadron_id) : null,
  title: String(d.title || '').slice(0, 200),
  description: d.description ? String(d.description).slice(0, 8000) : null,
  kind: EVENT_KINDS.includes(d.kind) ? d.kind : 'squadron',
  start_at: Number.isFinite(d.start_at) ? d.start_at : null,
  end_at: Number.isFinite(d.end_at) ? d.end_at : null,
  multi_squadron: d.multi_squadron ? 1 : 0,
  track_attendance: d.track_attendance === false ? 0 : 1,
});

export function createEvent(wingId, d, createdBy = null) {
  const e = normEvent(d);
  const now = Date.now();
  const info = insertEvent.run(
    wingId, e.squadron_id, e.title, e.description, e.kind, e.start_at, e.end_at,
    e.multi_squadron, e.track_attendance, createdBy, now, now
  );
  return selectEvent.get(Number(info.lastInsertRowid));
}
export function getEvent(id) {
  return selectEvent.get(id) || null;
}
export function updateEvent(id, d) {
  const e = normEvent(d);
  updateEventStmt.run(
    e.squadron_id, e.title, e.description, e.kind, e.start_at, e.end_at,
    e.multi_squadron, e.track_attendance, Date.now(), id
  );
  return selectEvent.get(id);
}
export function deleteEvent(id) {
  return deleteEventStmt.run(id).changes;
}

// --- list events in a range (for calendar) ------------------------------
const selectEventsInRange = db.prepare(`
  SELECT * FROM events
  WHERE wing_id = ? AND start_at >= ? AND start_at < ?
  ORDER BY start_at ASC
`);
const selectEventsBySquadronInRange = db.prepare(`
  SELECT * FROM events
  WHERE wing_id = ? AND start_at >= ? AND start_at < ?
    AND (squadron_id = ? OR multi_squadron = 1)
  ORDER BY start_at ASC
`);

export function getEventsInRange(wingId, fromMs, toMs, { squadronId } = {}) {
  return squadronId
    ? selectEventsBySquadronInRange.all(wingId, fromMs, toMs, squadronId)
    : selectEventsInRange.all(wingId, fromMs, toMs);
}

// --- attendance ---------------------------------------------------------
const upsertAttendance = db.prepare(`
  INSERT INTO event_attendance (event_id, member_id, status, recorded_by, recorded_at, notes)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(event_id, member_id) DO UPDATE SET
    status = excluded.status, recorded_by = excluded.recorded_by,
    recorded_at = excluded.recorded_at, notes = excluded.notes
`);
const deleteAttendanceStmt = db.prepare(
  'DELETE FROM event_attendance WHERE event_id = ? AND member_id = ?'
);
const selectEventAttendance = db.prepare(`
  SELECT a.member_id, a.status, a.recorded_at, a.notes,
         m.callsign, m.modex, m.name, m.squadron_id, sq.tag AS sqn_tag
  FROM event_attendance a
  JOIN members m ON m.id = a.member_id
  LEFT JOIN squadrons sq ON sq.id = m.squadron_id
  WHERE a.event_id = ?
  ORDER BY sq.id ASC, m.modex ASC, m.callsign ASC
`);

export function markAttendance(eventId, memberId, status, { recordedBy, notes } = {}) {
  if (!ATTEND_STATUS.includes(status)) throw new Error('bad_status');
  upsertAttendance.run(eventId, memberId, status, recordedBy || null, Date.now(), notes || null);
}
export function clearAttendance(eventId, memberId) {
  return deleteAttendanceStmt.run(eventId, memberId).changes;
}
export function getEventAttendance(eventId) {
  return selectEventAttendance.all(eventId);
}

// Event roster: members expected at this event + their recorded attendance.
// Expected = members of the event's host squadron (organic, non-retired);
// if multi_squadron, include the wing as well.
const selectMembersBySquadronForRoster = db.prepare(`
  SELECT m.id, m.callsign, m.modex, m.name, m.subdivision, m.squadron_id,
         sq.tag AS sqn_tag, sq.name AS sqn_name
  FROM members m LEFT JOIN squadrons sq ON sq.id = m.squadron_id
  WHERE m.squadron_id = ? AND m.status != 'retired'
  ORDER BY m.modex ASC, m.callsign ASC
`);
const selectMembersByWingForRoster = db.prepare(`
  SELECT m.id, m.callsign, m.modex, m.name, m.subdivision, m.squadron_id,
         sq.tag AS sqn_tag, sq.name AS sqn_name
  FROM members m LEFT JOIN squadrons sq ON sq.id = m.squadron_id
  WHERE m.wing_id = ? AND m.status != 'retired'
  ORDER BY sq.id ASC, m.modex ASC, m.callsign ASC
`);

export function getEventRoster(eventId) {
  const event = selectEvent.get(eventId);
  if (!event) return null;
  const expected = event.multi_squadron
    ? selectMembersByWingForRoster.all(event.wing_id)
    : (event.squadron_id ? selectMembersBySquadronForRoster.all(event.squadron_id) : []);
  const attMap = new Map(getEventAttendance(eventId).map((a) => [a.member_id, a]));
  return expected.map((m) => ({
    ...m,
    attendance: attMap.get(m.id) || null,
  }));
}

// --- LOA ----------------------------------------------------------------
const insertLOA = db.prepare(`
  INSERT INTO loa_requests (member_id, start_at, end_at, reason, status, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);
const selectLOA = db.prepare('SELECT * FROM loa_requests WHERE id = ?');
const updateLOAStmt = db.prepare(
  'UPDATE loa_requests SET status = ?, approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ?'
);
const deleteLOAStmt = db.prepare('DELETE FROM loa_requests WHERE id = ?');
const selectWingLOAs = db.prepare(`
  SELECT l.*, m.callsign, m.modex, m.squadron_id, sq.tag AS sqn_tag
  FROM loa_requests l
  JOIN members m ON m.id = l.member_id
  LEFT JOIN squadrons sq ON sq.id = m.squadron_id
  WHERE m.wing_id = ? AND l.end_at >= ?
  ORDER BY l.start_at ASC
`);
const selectMemberLOAs = db.prepare(`
  SELECT * FROM loa_requests WHERE member_id = ? AND end_at >= ? ORDER BY start_at ASC
`);

export function createLOA(memberId, { start_at, end_at, reason }) {
  if (!Number.isFinite(start_at) || !Number.isFinite(end_at) || end_at < start_at) {
    throw new Error('bad_dates');
  }
  const now = Date.now();
  const info = insertLOA.run(memberId, start_at, end_at, reason || null, 'requested', now, now);
  return selectLOA.get(Number(info.lastInsertRowid));
}
export function getLOA(id) { return selectLOA.get(id) || null; }
export function setLOAStatus(id, status, approverId = null) {
  if (!LOA_STATUS.includes(status)) throw new Error('bad_status');
  updateLOAStmt.run(status, approverId, status === 'approved' ? Date.now() : null, Date.now(), id);
  return selectLOA.get(id);
}
export function deleteLOA(id) { return deleteLOAStmt.run(id).changes; }
export function getUpcomingLOAs(wingId) {
  return selectWingLOAs.all(wingId, Date.now() - 86400000);
}
export function getMemberLOAs(memberId) {
  return selectMemberLOAs.all(memberId, Date.now() - 86400000);
}

// --- attendance metrics -------------------------------------------------
const countEventsInRange = db.prepare(`
  SELECT COUNT(*) AS n FROM events
  WHERE wing_id = ? AND start_at >= ? AND start_at < ? AND track_attendance = 1
`);
const countAttendanceByStatus = db.prepare(`
  SELECT a.status, COUNT(*) AS n
  FROM event_attendance a JOIN events e ON e.id = a.event_id
  WHERE e.wing_id = ? AND e.start_at >= ? AND e.start_at < ? AND e.track_attendance = 1
  GROUP BY a.status
`);
const countPilotsTracked = db.prepare(`
  SELECT COUNT(DISTINCT a.member_id) AS n
  FROM event_attendance a JOIN events e ON e.id = a.event_id
  WHERE e.wing_id = ? AND e.start_at >= ? AND e.start_at < ?
`);
const selectPilotPerformance = db.prepare(`
  SELECT m.id AS member_id, m.callsign, m.modex, m.rank, m.squadron_id, sq.tag AS sqn_tag,
         COUNT(a.event_id) AS events,
         SUM(CASE WHEN a.status = 'present' THEN 1 ELSE 0 END) AS present,
         SUM(CASE WHEN a.status = 'extra_credit' THEN 1 ELSE 0 END) AS extra_credit,
         SUM(CASE WHEN a.status = 'excused' THEN 1 ELSE 0 END) AS excused,
         SUM(CASE WHEN a.status = 'ua' THEN 1 ELSE 0 END) AS ua,
         SUM(CASE WHEN a.status = 'absent' THEN 1 ELSE 0 END) AS absent
  FROM members m
  LEFT JOIN event_attendance a ON a.member_id = m.id
  LEFT JOIN events e ON e.id = a.event_id AND e.wing_id = m.wing_id
    AND e.start_at >= ? AND e.start_at < ? AND e.track_attendance = 1
  LEFT JOIN squadrons sq ON sq.id = m.squadron_id
  WHERE m.wing_id = ? AND m.status != 'retired'
  GROUP BY m.id
  HAVING events > 0
  ORDER BY m.squadron_id ASC, m.modex ASC, m.callsign ASC
`);

export function getAttendanceMetrics(wingId, fromMs, toMs) {
  const events_tracked = countEventsInRange.get(wingId, fromMs, toMs).n;
  const byStatus = Object.fromEntries(
    countAttendanceByStatus.all(wingId, fromMs, toMs).map((r) => [r.status, r.n])
  );
  const present = byStatus.present || 0;
  const extra = byStatus.extra_credit || 0;
  const excused = byStatus.excused || 0;
  const ua = byStatus.ua || 0;
  const absent = byStatus.absent || 0;
  const totalMarks = present + extra + excused + ua + absent;
  const attendance_rate = totalMarks ? Math.round(((present + extra) / totalMarks) * 1000) / 10 : 0;
  return {
    events_tracked,
    pilots_tracked: countPilotsTracked.get(wingId, fromMs, toMs).n,
    attendance_rate,                    // percent (one decimal)
    present, extra_credit: extra, excused, ua_instances: ua, absent,
  };
}

export function getPilotPerformance(wingId, fromMs, toMs) {
  return selectPilotPerformance.all(fromMs, toMs, wingId).map((r) => {
    const tracked = r.events;
    const attended = (r.present || 0) + (r.extra_credit || 0);
    const accounted = attended + (r.excused || 0);
    return {
      ...r,
      attendance_rate: tracked ? Math.round((attended / tracked) * 1000) / 10 : 0,
      accountability: tracked ? Math.round((accounted / tracked) * 1000) / 10 : 0,
    };
  });
}
