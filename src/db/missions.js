import db from './index.js';

// --- schema ---------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS campaigns (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    wing_id     INTEGER NOT NULL REFERENCES wings(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    description TEXT,
    status      TEXT NOT NULL DEFAULT 'active',
    start_at    INTEGER,
    end_at      INTEGER,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_campaigns_wing ON campaigns (wing_id);

  CREATE TABLE IF NOT EXISTS missions (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    wing_id          INTEGER NOT NULL REFERENCES wings(id) ON DELETE CASCADE,
    campaign_id      INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
    type             TEXT NOT NULL DEFAULT 'standalone',   -- campaign | standalone | library
    name             TEXT NOT NULL,
    primary_aircraft TEXT,
    status           TEXT NOT NULL DEFAULT 'planning',     -- planning | active | completed | archived
    start_at         INTEGER,
    duration_min     INTEGER,
    description      TEXT,
    miz_ref          TEXT,                                 -- link/handle to a Mizmaker plan (Phase B)
    created_by       TEXT,
    created_at       INTEGER NOT NULL,
    updated_at       INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_missions_wing ON missions (wing_id, start_at);
  CREATE INDEX IF NOT EXISTS idx_missions_campaign ON missions (campaign_id);

  CREATE TABLE IF NOT EXISTS mission_flights (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    mission_id  INTEGER NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    callsign    TEXT,
    aircraft    TEXT,
    role        TEXT,
    slots       INTEGER NOT NULL DEFAULT 1,
    squadron_id INTEGER REFERENCES squadrons(id) ON DELETE SET NULL,
    notes       TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_flights_mission ON mission_flights (mission_id, sort_order);

  CREATE TABLE IF NOT EXISTS mission_signups (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    mission_id INTEGER NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
    flight_id  INTEGER NOT NULL REFERENCES mission_flights(id) ON DELETE CASCADE,
    member_id  INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    status     TEXT NOT NULL DEFAULT 'signed',  -- signed | tentative | confirmed
    created_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_signups_flight_member ON mission_signups (flight_id, member_id);
  CREATE INDEX IF NOT EXISTS idx_signups_member ON mission_signups (member_id);
  CREATE INDEX IF NOT EXISTS idx_signups_mission ON mission_signups (mission_id);

  CREATE TABLE IF NOT EXISTS mission_squadron_access (
    mission_id  INTEGER NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
    squadron_id INTEGER NOT NULL REFERENCES squadrons(id) ON DELETE CASCADE,
    role        TEXT NOT NULL DEFAULT 'invited',  -- host | invited
    PRIMARY KEY (mission_id, squadron_id)
  );

  CREATE TABLE IF NOT EXISTS mission_resources (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    mission_id INTEGER NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
    kind       TEXT NOT NULL DEFAULT 'link',   -- briefing | kneeboard | miz | link
    label      TEXT,
    url        TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_resources_mission ON mission_resources (mission_id);
`);

const MISSION_TYPES = ['campaign', 'standalone', 'library'];
const MISSION_STATUS = ['planning', 'active', 'completed', 'archived'];
const SIGNUP_STATUS = ['signed', 'tentative', 'confirmed'];

// --- campaigns -------------------------------------------------------------
const insertCampaign = db.prepare(
  'INSERT INTO campaigns (wing_id, name, description, status, start_at, end_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
);
const selectCampaignsByWing = db.prepare('SELECT * FROM campaigns WHERE wing_id = ? ORDER BY created_at DESC');
const selectCampaign = db.prepare('SELECT * FROM campaigns WHERE id = ?');
const updateCampaignStmt = db.prepare(
  'UPDATE campaigns SET name = ?, description = ?, status = ?, start_at = ?, end_at = ? WHERE id = ?'
);
const deleteCampaignStmt = db.prepare('DELETE FROM campaigns WHERE id = ?');
const countMissionsInCampaign = db.prepare('SELECT COUNT(*) AS n FROM missions WHERE campaign_id = ?');

export function createCampaign(wingId, { name, description, status, start_at, end_at }) {
  const info = insertCampaign.run(
    wingId, name, description ?? null, status || 'active',
    Number.isFinite(start_at) ? start_at : null, Number.isFinite(end_at) ? end_at : null, Date.now()
  );
  return selectCampaign.get(Number(info.lastInsertRowid));
}
export function getCampaigns(wingId) {
  return selectCampaignsByWing.all(wingId).map((c) => ({ ...c, missions: countMissionsInCampaign.get(c.id).n }));
}
export function getCampaign(id) { return selectCampaign.get(id) || null; }
export function updateCampaign(id, { name, description, status, start_at, end_at }) {
  updateCampaignStmt.run(name, description ?? null, status || 'active',
    Number.isFinite(start_at) ? start_at : null, Number.isFinite(end_at) ? end_at : null, id);
  return getCampaign(id);
}
export function deleteCampaign(id) { return deleteCampaignStmt.run(id).changes; }

// --- missions --------------------------------------------------------------
const insertMission = db.prepare(`
  INSERT INTO missions (wing_id, campaign_id, type, name, primary_aircraft, status, start_at, duration_min, description, miz_ref, created_by, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const selectMission = db.prepare('SELECT * FROM missions WHERE id = ?');
const updateMissionStmt = db.prepare(`
  UPDATE missions SET campaign_id = ?, type = ?, name = ?, primary_aircraft = ?, status = ?,
    start_at = ?, duration_min = ?, description = ?, miz_ref = ?, updated_at = ?
  WHERE id = ?
`);
const deleteMissionStmt = db.prepare('DELETE FROM missions WHERE id = ?');

const normMission = (d) => ({
  campaign_id: d.campaign_id ? Number(d.campaign_id) : null,
  type: MISSION_TYPES.includes(d.type) ? d.type : 'standalone',
  name: String(d.name || '').slice(0, 160),
  primary_aircraft: d.primary_aircraft ? String(d.primary_aircraft).slice(0, 120) : null,
  status: MISSION_STATUS.includes(d.status) ? d.status : 'planning',
  start_at: Number.isFinite(d.start_at) ? d.start_at : null,
  duration_min: Number.isFinite(d.duration_min) ? d.duration_min : null,
  description: d.description ? String(d.description).slice(0, 8000) : null,
  miz_ref: d.miz_ref ? String(d.miz_ref).slice(0, 500) : null,
});

export function createMission(wingId, d, createdBy = null) {
  const m = normMission(d);
  const now = Date.now();
  const info = insertMission.run(
    wingId, m.campaign_id, m.type, m.name, m.primary_aircraft, m.status,
    m.start_at, m.duration_min, m.description, m.miz_ref, createdBy, now, now
  );
  return getMissionFull(Number(info.lastInsertRowid));
}
export function updateMission(id, d) {
  const m = normMission(d);
  updateMissionStmt.run(
    m.campaign_id, m.type, m.name, m.primary_aircraft, m.status,
    m.start_at, m.duration_min, m.description, m.miz_ref, Date.now(), id
  );
  return getMissionFull(id);
}
export function deleteMission(id) { return deleteMissionStmt.run(id).changes; }

// Dynamic filtered list for the "Manage Missions" table.
export function listMissions(wingId, { status, type, campaign_id, aircraft, search } = {}) {
  const where = ['wing_id = ?'];
  const args = [wingId];
  if (MISSION_STATUS.includes(status)) { where.push('status = ?'); args.push(status); }
  if (MISSION_TYPES.includes(type)) { where.push('type = ?'); args.push(type); }
  if (Number(campaign_id)) { where.push('campaign_id = ?'); args.push(Number(campaign_id)); }
  if (aircraft) { where.push('primary_aircraft = ?'); args.push(aircraft); }
  if (search) { where.push('name LIKE ?'); args.push(`%${String(search).slice(0, 80)}%`); }
  const rows = db
    .prepare(`SELECT * FROM missions WHERE ${where.join(' AND ')} ORDER BY COALESCE(start_at, created_at) DESC LIMIT 500`)
    .all(...args);
  return rows.map((m) => ({ ...m, ...rollup(m.id), campaign_name: m.campaign_id ? getCampaign(m.campaign_id)?.name || null : null }));
}

// signed/total seat counts for a mission
const seatRollup = db.prepare(`
  SELECT COALESCE(SUM(f.slots), 0) AS total,
         (SELECT COUNT(*) FROM mission_signups s WHERE s.mission_id = ?) AS filled
  FROM mission_flights f WHERE f.mission_id = ?
`);
function rollup(missionId) {
  const r = seatRollup.get(missionId, missionId);
  return { seats_total: r.total, seats_filled: r.filled };
}

// --- flights ---------------------------------------------------------------
const insertFlight = db.prepare(
  'INSERT INTO mission_flights (mission_id, sort_order, callsign, aircraft, role, slots, squadron_id, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
);
const selectFlightsByMission = db.prepare('SELECT * FROM mission_flights WHERE mission_id = ? ORDER BY sort_order ASC, id ASC');
const selectFlight = db.prepare('SELECT * FROM mission_flights WHERE id = ?');
const updateFlightStmt = db.prepare(
  'UPDATE mission_flights SET sort_order = ?, callsign = ?, aircraft = ?, role = ?, slots = ?, squadron_id = ?, notes = ? WHERE id = ?'
);
const deleteFlightStmt = db.prepare('DELETE FROM mission_flights WHERE id = ?');

const normFlight = (d, fallbackAircraft = null) => ({
  sort_order: Number(d.sort_order) || 0,
  callsign: d.callsign ? String(d.callsign).slice(0, 40) : null,
  aircraft: d.aircraft ? String(d.aircraft).slice(0, 120) : fallbackAircraft,
  role: d.role ? String(d.role).slice(0, 120) : null,
  slots: Math.max(1, Math.min(20, Number(d.slots) || 1)),
  squadron_id: d.squadron_id ? Number(d.squadron_id) : null,
  notes: d.notes ? String(d.notes).slice(0, 1000) : null,
});

export function addFlight(missionId, d) {
  const mission = selectMission.get(missionId);
  const f = normFlight(d, mission?.primary_aircraft || null);
  const info = insertFlight.run(missionId, f.sort_order, f.callsign, f.aircraft, f.role, f.slots, f.squadron_id, f.notes);
  return selectFlight.get(Number(info.lastInsertRowid));
}
export function getFlight(id) { return selectFlight.get(id) || null; }
export function updateFlight(id, d) {
  const f = normFlight(d);
  updateFlightStmt.run(f.sort_order, f.callsign, f.aircraft, f.role, f.slots, f.squadron_id, f.notes, id);
  return selectFlight.get(id);
}
export function deleteFlight(id) { return deleteFlightStmt.run(id).changes; }

// --- signups ---------------------------------------------------------------
const insertSignup = db.prepare(
  'INSERT INTO mission_signups (mission_id, flight_id, member_id, status, created_at) VALUES (?, ?, ?, ?, ?)'
);
const selectSignupsByFlight = db.prepare(`
  SELECT s.*, m.callsign, m.name, m.rank
  FROM mission_signups s JOIN members m ON m.id = s.member_id
  WHERE s.flight_id = ? ORDER BY s.created_at ASC
`);
const selectSignup = db.prepare('SELECT * FROM mission_signups WHERE id = ?');
const deleteSignupStmt = db.prepare('DELETE FROM mission_signups WHERE id = ?');
const countFlightSignups = db.prepare('SELECT COUNT(*) AS n FROM mission_signups WHERE flight_id = ?');
const selectMemberSignupInMission = db.prepare('SELECT * FROM mission_signups WHERE mission_id = ? AND member_id = ?');

export function signUp(flightId, memberId, status = 'signed') {
  const flight = selectFlight.get(flightId);
  if (!flight) throw new Error('no_flight');
  if (countFlightSignups.get(flightId).n >= flight.slots) throw new Error('flight_full');
  // one seat per member per mission (can't double-book across flights of the same mission)
  const existing = selectMemberSignupInMission.get(flight.mission_id, memberId);
  if (existing) {
    if (existing.flight_id === flightId) return existing;
    throw new Error('already_signed');
  }
  const info = insertSignup.run(
    flight.mission_id, flightId, memberId,
    SIGNUP_STATUS.includes(status) ? status : 'signed', Date.now()
  );
  return selectSignup.get(Number(info.lastInsertRowid));
}
export function getSignup(id) { return selectSignup.get(id) || null; }
export function getFlightSignups(flightId) { return selectSignupsByFlight.all(flightId); }
export function removeSignup(id) { return deleteSignupStmt.run(id).changes; }

// --- squadron access -------------------------------------------------------
const insertAccess = db.prepare(
  'INSERT INTO mission_squadron_access (mission_id, squadron_id, role) VALUES (?, ?, ?) ON CONFLICT(mission_id, squadron_id) DO UPDATE SET role = excluded.role'
);
const deleteAccessByMission = db.prepare('DELETE FROM mission_squadron_access WHERE mission_id = ?');
const selectAccess = db.prepare(`
  SELECT a.squadron_id, a.role, sq.name, sq.tag
  FROM mission_squadron_access a JOIN squadrons sq ON sq.id = a.squadron_id
  WHERE a.mission_id = ?
`);

export function setMissionAccess(missionId, list) {
  deleteAccessByMission.run(missionId);
  for (const a of (Array.isArray(list) ? list : []).slice(0, 50)) {
    if (!Number(a.squadron_id)) continue;
    insertAccess.run(missionId, Number(a.squadron_id), a.role === 'host' ? 'host' : 'invited');
  }
  return selectAccess.all(missionId);
}
export function getMissionAccess(missionId) { return selectAccess.all(missionId); }

// --- resources -------------------------------------------------------------
const insertResource = db.prepare(
  'INSERT INTO mission_resources (mission_id, kind, label, url, created_at) VALUES (?, ?, ?, ?, ?)'
);
const selectResourcesByMission = db.prepare('SELECT * FROM mission_resources WHERE mission_id = ? ORDER BY id ASC');
const selectResource = db.prepare('SELECT * FROM mission_resources WHERE id = ?');
const deleteResourceStmt = db.prepare('DELETE FROM mission_resources WHERE id = ?');
const RESOURCE_KINDS = ['briefing', 'kneeboard', 'miz', 'link'];

export function addResource(missionId, { kind, label, url }) {
  const info = insertResource.run(
    missionId, RESOURCE_KINDS.includes(kind) ? kind : 'link',
    label ? String(label).slice(0, 200) : null, url ? String(url).slice(0, 1000) : null, Date.now()
  );
  return selectResource.get(Number(info.lastInsertRowid));
}
export function getResource(id) { return selectResource.get(id) || null; }
export function deleteResource(id) { return deleteResourceStmt.run(id).changes; }

// --- composite reads -------------------------------------------------------
export function getMissionFull(id) {
  const mission = selectMission.get(id);
  if (!mission) return null;
  const flights = selectFlightsByMission.all(id).map((f) => {
    const signups = getFlightSignups(f.id);
    return { ...f, signups, filled: signups.length };
  });
  return {
    ...mission,
    ...rollup(id),
    campaign_name: mission.campaign_id ? getCampaign(mission.campaign_id)?.name || null : null,
    flights,
    squadron_access: getMissionAccess(id),
    resources: selectResourcesByMission.all(id),
  };
}

export function cloneMission(id, { wingId, type = 'standalone', name } = {}, createdBy = null) {
  const src = getMissionFull(id);
  if (!src) return null;
  const clone = createMission(wingId || src.wing_id, {
    type, name: name || `${src.name} (copy)`, primary_aircraft: src.primary_aircraft,
    status: 'planning', duration_min: src.duration_min, description: src.description, miz_ref: src.miz_ref,
  }, createdBy);
  for (const f of src.flights) {
    addFlight(clone.id, { sort_order: f.sort_order, callsign: f.callsign, aircraft: f.aircraft, role: f.role, slots: f.slots, squadron_id: f.squadron_id, notes: f.notes });
  }
  for (const r of src.resources) addResource(clone.id, r);
  return getMissionFull(clone.id);
}

// --- dashboard -------------------------------------------------------------
const selectUpcoming = db.prepare(`
  SELECT * FROM missions
  WHERE wing_id = ? AND status IN ('planning', 'active')
  ORDER BY COALESCE(start_at, created_at) ASC LIMIT 25
`);
const selectMySignups = db.prepare(`
  SELECT s.id AS signup_id, s.status AS signup_status, s.flight_id,
         f.callsign, f.aircraft AS flight_aircraft, f.role,
         mi.id AS mission_id, mi.name AS mission_name, mi.status AS mission_status, mi.start_at
  FROM mission_signups s
  JOIN mission_flights f ON f.id = s.flight_id
  JOIN missions mi ON mi.id = s.mission_id
  WHERE s.member_id = ? AND mi.status IN ('planning', 'active')
  ORDER BY COALESCE(mi.start_at, mi.created_at) ASC
`);

export function getDashboard(wingId, memberId) {
  const upcoming = selectUpcoming.all(wingId).map((m) => ({ ...m, ...rollup(m.id) }));
  const mySignups = memberId ? selectMySignups.all(memberId) : [];
  return { upcoming, mySignups };
}
