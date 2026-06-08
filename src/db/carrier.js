// Carrier / LSO tier — the third sublevel below Wing/Squadron.
//
// Each wing owns one or more carriers (ships). Each trap is one arrested
// landing logged by an LSO/admin: grade, wire, AOA, lineup, glideslope,
// ball call, comments. Aggregate metrics (boarding rate, last-N greenie
// board) are derived from the trap log.

import db from './index.js';

// --- schema -------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS carriers (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    wing_id     INTEGER NOT NULL REFERENCES wings(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    hull        TEXT,                -- e.g. CVN-72
    class       TEXT,                -- Nimitz, Ford, Forrestal, Charles de Gaulle, ...
    brc         INTEGER,             -- base recovery course (deg)
    notes       TEXT,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_carriers_wing ON carriers (wing_id);

  CREATE TABLE IF NOT EXISTS traps (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    carrier_id  INTEGER NOT NULL REFERENCES carriers(id) ON DELETE CASCADE,
    member_id   INTEGER REFERENCES members(id) ON DELETE SET NULL,
    pilot_name  TEXT,                -- snapshot at recording time (so it survives detach)
    event_id    INTEGER,                -- soft FK to events(id); not enforced because events.js loads later
    airframe    TEXT,
    time_at     INTEGER NOT NULL,
    grade       TEXT NOT NULL,       -- _OK_ | OK | (OK) | -- | C | B | WO | TWO | WOFD
    wire        INTEGER,             -- 1..4 (null for bolter/WO)
    aoa         TEXT,                -- HI / OK / LO  (or finer)
    lineup      TEXT,                -- LUL / OK / LUR
    glideslope  TEXT,                -- HI / OK / LO
    ball_call   TEXT,                -- raw text e.g. "207 Hornet ball 3.2 auto"
    comments    TEXT,                -- LSO comments
    weather     TEXT,
    recorded_by TEXT,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_traps_carrier_time ON traps (carrier_id, time_at);
  CREATE INDEX IF NOT EXISTS idx_traps_member_time  ON traps (member_id, time_at);
  CREATE INDEX IF NOT EXISTS idx_traps_event ON traps (event_id);
`);

// --- carriers CRUD ------------------------------------------------------
const insertCarrier = db.prepare(`
  INSERT INTO carriers (wing_id, name, hull, class, brc, notes, sort_order, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
const selectCarriers = db.prepare('SELECT * FROM carriers WHERE wing_id = ? ORDER BY sort_order, name');
const selectCarrier = db.prepare('SELECT * FROM carriers WHERE id = ?');
const updateCarrierStmt = db.prepare(`
  UPDATE carriers SET name = ?, hull = ?, class = ?, brc = ?, notes = ?, sort_order = ? WHERE id = ?
`);
const deleteCarrierStmt = db.prepare('DELETE FROM carriers WHERE id = ?');

const str = (v, n) => (v == null || v === '' ? null : String(v).slice(0, n));

export function createCarrier(wingId, d) {
  const now = Date.now();
  const r = insertCarrier.run(
    wingId,
    str(d.name, 120) || 'Unnamed Carrier',
    str(d.hull, 20),
    str(d.class, 60),
    Number.isFinite(Number(d.brc)) ? Number(d.brc) : null,
    str(d.notes, 4000),
    Number.isFinite(Number(d.sort_order)) ? Number(d.sort_order) : 0,
    now,
  );
  return getCarrier(Number(r.lastInsertRowid));
}

export function getCarriers(wingId) {
  return selectCarriers.all(wingId);
}

export function getCarrier(id) {
  return selectCarrier.get(id) || null;
}

export function updateCarrier(id, d) {
  const cur = getCarrier(id);
  if (!cur) return null;
  updateCarrierStmt.run(
    str(d.name, 120) ?? cur.name,
    d.hull === undefined ? cur.hull : str(d.hull, 20),
    d.class === undefined ? cur.class : str(d.class, 60),
    d.brc === undefined ? cur.brc : (Number.isFinite(Number(d.brc)) ? Number(d.brc) : null),
    d.notes === undefined ? cur.notes : str(d.notes, 4000),
    d.sort_order === undefined ? cur.sort_order : Number(d.sort_order) || 0,
    id,
  );
  return getCarrier(id);
}

export function deleteCarrier(id) {
  return deleteCarrierStmt.run(id).changes;
}

// --- traps --------------------------------------------------------------
// Grade taxonomy
//   _OK_ — perfect pass (rare)            score 5.0
//   OK   — solid pass                     score 4.0
//   (OK) — fair pass                      score 3.0
//   --   — no grade (technique deviation) score 2.0
//   B    — bolter                         score 2.5
//   TWO  — technique waveoff              score 2.0
//   C    — cut pass (unsafe)              score 0.0
//   WO   — waveoff for safety             score 1.0
//   WOFD — waveoff fouled deck (not pilot's fault, doesn't count)
export const TRAP_GRADES = ['_OK_', 'OK', '(OK)', '--', 'B', 'TWO', 'C', 'WO', 'WOFD'];

const GRADE_SCORES = {
  '_OK_': 5.0, 'OK': 4.0, '(OK)': 3.0, '--': 2.0, 'B': 2.5,
  'TWO': 2.0, 'C': 0.0, 'WO': 1.0, 'WOFD': null,
};

export function gradeScore(g) {
  return GRADE_SCORES[g] ?? null;
}

// A trap "counts toward boarding rate" when it represents a landing attempt
// that completed on the pilot's call — i.e. not a fouled-deck waveoff.
function isAttempt(g) { return g !== 'WOFD'; }

// A trap is a "good trap" (boarding) when the aircraft caught a wire on a
// safe pass: OK, _OK_, (OK), --, TWO. Bolter / WO / cut pass / fouled-deck
// don't count as boardings.
function isBoarding(g) { return ['_OK_', 'OK', '(OK)', '--'].includes(g); }

const insertTrap = db.prepare(`
  INSERT INTO traps (carrier_id, member_id, pilot_name, event_id, airframe, time_at,
    grade, wire, aoa, lineup, glideslope, ball_call, comments, weather, recorded_by, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const selectTrap = db.prepare('SELECT * FROM traps WHERE id = ?');
const deleteTrapStmt = db.prepare('DELETE FROM traps WHERE id = ?');

export function recordTrap(carrierId, d, recordedBy) {
  if (!TRAP_GRADES.includes(d.grade)) throw new Error('bad_grade');
  const now = Date.now();
  const r = insertTrap.run(
    carrierId,
    d.member_id ? Number(d.member_id) : null,
    str(d.pilot_name, 120),
    d.event_id ? Number(d.event_id) : null,
    str(d.airframe, 40),
    Number(d.time_at) || now,
    d.grade,
    d.wire == null || d.wire === '' ? null : Math.max(0, Math.min(4, Number(d.wire))),
    str(d.aoa, 20),
    str(d.lineup, 20),
    str(d.glideslope, 20),
    str(d.ball_call, 200),
    str(d.comments, 2000),
    str(d.weather, 200),
    recordedBy || null,
    now,
  );
  return getTrap(Number(r.lastInsertRowid));
}

export function getTrap(id) {
  return selectTrap.get(id) || null;
}

export function deleteTrap(id) {
  return deleteTrapStmt.run(id).changes;
}

const selectTrapsByCarrier = db.prepare(`
  SELECT t.*, m.callsign, m.name AS member_name
  FROM traps t
  LEFT JOIN members m ON m.id = t.member_id
  WHERE t.carrier_id = ?
  ORDER BY t.time_at DESC
  LIMIT ?
`);
export function getTrapsByCarrier(carrierId, limit = 100) {
  return selectTrapsByCarrier.all(carrierId, limit);
}

const selectTrapsByMember = db.prepare(`
  SELECT t.*, c.name AS carrier_name, c.hull
  FROM traps t
  JOIN carriers c ON c.id = t.carrier_id
  WHERE t.member_id = ?
  ORDER BY t.time_at DESC
  LIMIT ?
`);
export function getTrapsByMember(memberId, limit = 50) {
  return selectTrapsByMember.all(memberId, limit);
}

const selectTrapsByEvent = db.prepare(`
  SELECT t.*, c.name AS carrier_name, m.callsign, m.name AS member_name
  FROM traps t
  JOIN carriers c ON c.id = t.carrier_id
  LEFT JOIN members m ON m.id = t.member_id
  WHERE t.event_id = ?
  ORDER BY t.time_at DESC
`);
export function getTrapsByEvent(eventId) {
  return selectTrapsByEvent.all(eventId);
}

const selectMemberAggStmt = db.prepare(`
  SELECT grade FROM traps WHERE member_id = ? ORDER BY time_at DESC
`);
export function getMemberBoardingStats(memberId) {
  const rows = selectMemberAggStmt.all(memberId);
  let attempts = 0, boardings = 0, scoreSum = 0, scoreCount = 0;
  for (const r of rows) {
    if (isAttempt(r.grade)) attempts++;
    if (isBoarding(r.grade)) boardings++;
    const s = gradeScore(r.grade);
    if (s != null) { scoreSum += s; scoreCount++; }
  }
  return {
    total: rows.length,
    attempts,
    boardings,
    boarding_rate: attempts ? +(boardings / attempts).toFixed(3) : null,
    avg_score: scoreCount ? +(scoreSum / scoreCount).toFixed(2) : null,
    last_grades: rows.slice(0, 10).map((r) => r.grade),
  };
}

// Greenie board for a wing — one row per pilot with the most-recent 10 traps.
const selectWingGreenieStmt = db.prepare(`
  SELECT t.member_id, m.callsign, m.name AS member_name, t.grade, t.time_at
  FROM traps t
  JOIN carriers c ON c.id = t.carrier_id
  LEFT JOIN members m ON m.id = t.member_id
  WHERE c.wing_id = ? AND t.member_id IS NOT NULL
  ORDER BY t.member_id, t.time_at DESC
`);
export function getWingGreenieBoard(wingId, n = 10) {
  const rows = selectWingGreenieStmt.all(wingId);
  const byMember = new Map();
  for (const r of rows) {
    const list = byMember.get(r.member_id) || { member_id: r.member_id, callsign: r.callsign, name: r.member_name, grades: [] };
    if (list.grades.length < n) list.grades.push(r.grade);
    byMember.set(r.member_id, list);
  }
  const out = [];
  for (const v of byMember.values()) {
    let scoreSum = 0, scoreCount = 0, boardings = 0, attempts = 0;
    for (const g of v.grades) {
      const s = gradeScore(g);
      if (s != null) { scoreSum += s; scoreCount++; }
      if (isAttempt(g)) attempts++;
      if (isBoarding(g)) boardings++;
    }
    out.push({
      member_id: v.member_id,
      callsign: v.callsign,
      name: v.name,
      grades: v.grades,
      avg_score: scoreCount ? +(scoreSum / scoreCount).toFixed(2) : null,
      boarding_rate: attempts ? +(boardings / attempts).toFixed(3) : null,
    });
  }
  // Sort by avg_score desc, then boarding_rate desc, then callsign
  out.sort((a, b) => (b.avg_score ?? -1) - (a.avg_score ?? -1)
    || (b.boarding_rate ?? -1) - (a.boarding_rate ?? -1)
    || (a.callsign || '').localeCompare(b.callsign || ''));
  return out;
}
