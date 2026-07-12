import db, { ensureColumn, resolveAlias } from './index.js';

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

  -- Flight/slot sign-ups for an event (mirrors the Ops Bot's signup model so
  -- the two stay in sync). A signer is identified by their Discord user id —
  -- the cross-system key. member_id is the resolved roster member when known
  -- (null = a Discord user not on the roster, i.e. a guest). source records
  -- which side the signup came from so we don't echo it back into a loop.
  CREATE TABLE IF NOT EXISTS event_signups (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id        INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    role_label      TEXT NOT NULL,
    discord_user_id TEXT NOT NULL,
    member_id       INTEGER REFERENCES members(id) ON DELETE SET NULL,
    display_name    TEXT,
    source          TEXT NOT NULL DEFAULT 'site',  -- site | discord
    created_at      INTEGER NOT NULL,
    UNIQUE (event_id, role_label, discord_user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_evt_signup_event ON event_signups (event_id);
  CREATE INDEX IF NOT EXISTS idx_evt_signup_member ON event_signups (member_id);

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

// Flight/slot definitions for the event, stored as JSON to match the Ops Bot's
// event format for a clean pass-through on publish:
//   roles    = [{ label, group, limit, qual, emoji }]  (one entry per slot)
//   taskings = { "<flight/group name>": "STRIKE" | "SEAD" | ... }
ensureColumn('events', 'roles', 'TEXT');
ensureColumn('events', 'taskings', 'TEXT');
// When to auto-post the event to Discord: null = don't auto-post (manual only);
// a timestamp = post at/after that moment (a background scheduler handles it).
// Once posted, discord_message_id is set, which keeps it from posting twice.
ensureColumn('events', 'discord_post_at', 'INTEGER');
// Optional link back to the mission this event was published from (OPT ⇄ RR
// loop). Plain INTEGER (no FK) so the ALTER is portable; the share endpoint
// resolves the mission itself and tolerates a dangling id. null = standalone
// event not generated from a mission.
ensureColumn('events', 'mission_id', 'INTEGER');
// Post-mission AAR summary pushed back from the planner (OPT ⇄ RR loop, hop 7).
// Free text shown on the event page once a mission has flown.
ensureColumn('events', 'result_summary', 'TEXT');
// Lifecycle status (mirrors missions). NULL on legacy rows = treated as 'scheduled'.
ensureColumn('events', 'status', 'TEXT');
// Shared id across a recurring series (e.g. weekly Tue/Thu). NULL = one-off.
// Lets a future feature edit/delete the whole series; occurrences are otherwise
// independent events.
ensureColumn('events', 'recur_group', 'TEXT');

const EVENT_KINDS = ['squadron', 'extra_credit'];
const EVENT_STATUS = ['scheduled', 'active', 'completed', 'cancelled'];
const ATTEND_STATUS = ['present', 'absent', 'excused', 'extra_credit', 'ua'];
const LOA_STATUS = ['requested', 'approved', 'denied'];

// --- events CRUD --------------------------------------------------------
const insertEvent = db.prepare(`
  INSERT INTO events (wing_id, squadron_id, title, description, kind, start_at, end_at,
    multi_squadron, track_attendance, roles, taskings, mission_id, status, recur_group, created_by, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const selectEvent = db.prepare('SELECT * FROM events WHERE id = ?');
const updateEventStmt = db.prepare(`
  UPDATE events SET squadron_id = ?, title = ?, description = ?, kind = ?,
    start_at = ?, end_at = ?, multi_squadron = ?, track_attendance = ?,
    roles = ?, taskings = ?, status = ?, updated_at = ?
  WHERE id = ?
`);
const deleteEventStmt = db.prepare('DELETE FROM events WHERE id = ?');

const safeParse = (s, fallback) => { try { return s ? JSON.parse(s) : fallback; } catch { return fallback; } };
// Attach parsed roles/taskings so callers get usable arrays/objects, not JSON.
const parseEvent = (r) => (r ? { ...r, roles: safeParse(r.roles, []), taskings: safeParse(r.taskings, {}) } : null);

// One entry per slot: a flight (group) holds several slots (roles). limit is
// seats in that slot (usually 1). qual gates the slot to a roster qualification.
const normRoles = (roles) => {
  if (!Array.isArray(roles)) return [];
  return roles
    .slice(0, 60)
    .map((r) => ({
      label: String(r?.label || '').slice(0, 80),
      group: r?.group ? String(r.group).slice(0, 60) : '',
      limit: Number(r?.limit) > 0 ? Math.min(99, Math.floor(Number(r.limit))) : 1,
      qual: r?.qual ? String(r.qual).slice(0, 60) : null,
      emoji: r?.emoji ? String(r.emoji).slice(0, 32) : null,
    }))
    .filter((r) => r.label);
};
const normTaskings = (t) => {
  if (!t || typeof t !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(t)) {
    if (k && v) out[String(k).slice(0, 60)] = String(v).slice(0, 40);
  }
  return out;
};

const normEvent = (d) => ({
  squadron_id: d.squadron_id ? Number(d.squadron_id) : null,
  title: String(d.title || '').slice(0, 200),
  description: d.description ? String(d.description).slice(0, 8000) : null,
  kind: EVENT_KINDS.includes(d.kind) ? d.kind : 'squadron',
  start_at: Number.isFinite(d.start_at) ? d.start_at : null,
  end_at: Number.isFinite(d.end_at) ? d.end_at : null,
  multi_squadron: d.multi_squadron ? 1 : 0,
  track_attendance: d.track_attendance === false ? 0 : 1,
  roles: normRoles(d.roles),
  taskings: normTaskings(d.taskings),
  mission_id: d.mission_id ? Number(d.mission_id) : null,
  status: EVENT_STATUS.includes(d.status) ? d.status : 'scheduled',
  recur_group: d.recur_group ? String(d.recur_group).slice(0, 60) : null,
});

export function createEvent(wingId, d, createdBy = null) {
  const e = normEvent(d);
  const now = Date.now();
  const info = insertEvent.run(
    wingId, e.squadron_id, e.title, e.description, e.kind, e.start_at, e.end_at,
    e.multi_squadron, e.track_attendance, JSON.stringify(e.roles), JSON.stringify(e.taskings),
    e.mission_id, e.status, e.recur_group, createdBy, now, now
  );
  return parseEvent(selectEvent.get(Number(info.lastInsertRowid)));
}
export function getEvent(id) {
  return parseEvent(selectEvent.get(id));
}
export function updateEvent(id, d) {
  const e = normEvent(d);
  updateEventStmt.run(
    e.squadron_id, e.title, e.description, e.kind, e.start_at, e.end_at,
    e.multi_squadron, e.track_attendance, JSON.stringify(e.roles), JSON.stringify(e.taskings),
    e.status, Date.now(), id
  );
  return parseEvent(selectEvent.get(id));
}

// --- flight/slot sign-ups (two-way with the Ops Bot) --------------------
const upsertSignupStmt = db.prepare(`
  INSERT INTO event_signups (event_id, role_label, discord_user_id, member_id, display_name, source, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (event_id, role_label, discord_user_id)
  DO UPDATE SET member_id = excluded.member_id, display_name = excluded.display_name, source = excluded.source
`);
export function setEventSignup(eventId, { role_label, discord_user_id, member_id = null, display_name = null, source = 'site' }) {
  if (!eventId || !role_label || !discord_user_id) return false;
  upsertSignupStmt.run(
    eventId, String(role_label).slice(0, 80), String(discord_user_id),
    member_id ? Number(member_id) : null, display_name ? String(display_name).slice(0, 120) : null,
    source === 'discord' ? 'discord' : 'site', Date.now()
  );
  return true;
}
const removeSignupStmt = db.prepare('DELETE FROM event_signups WHERE event_id = ? AND role_label = ? AND discord_user_id = ?');
export function removeEventSignup(eventId, roleLabel, discordUserId) {
  return removeSignupStmt.run(eventId, String(roleLabel), String(discordUserId)).changes;
}
const removeAllSignupsForUserStmt = db.prepare('DELETE FROM event_signups WHERE event_id = ? AND discord_user_id = ?');
export function removeAllEventSignupsForUser(eventId, discordUserId) {
  return removeAllSignupsForUserStmt.run(eventId, String(discordUserId)).changes;
}
const selectEventSignups = db.prepare(`
  SELECT s.role_label, s.discord_user_id, s.member_id, s.display_name, s.source, s.created_at,
         m.callsign, m.rank, m.modex
  FROM event_signups s
  LEFT JOIN members m ON m.id = s.member_id
  WHERE s.event_id = ?
  ORDER BY s.created_at ASC
`);
export function getEventSignups(eventId) {
  return selectEventSignups.all(eventId);
}
const countRoleSignupsStmt = db.prepare('SELECT COUNT(*) AS n FROM event_signups WHERE event_id = ? AND role_label = ?');
export function countEventRoleSignups(eventId, roleLabel) {
  return countRoleSignupsStmt.get(eventId, String(roleLabel)).n;
}

// Upcoming events a member is signed up for (which flight slot) — for the
// "My sign-ups" panel on the dashboard.
const selectMemberEventSignups = db.prepare(`
  SELECT s.role_label, e.id AS event_id, e.title, e.start_at, e.kind
  FROM event_signups s JOIN events e ON e.id = s.event_id
  WHERE s.member_id = ? AND e.start_at >= ?
  ORDER BY e.start_at ASC
`);
export function getMemberEventSignups(memberId, fromMs = Date.now() - 3600000) {
  if (!memberId) return [];
  return selectMemberEventSignups.all(memberId, fromMs);
}

// --- OPT ⇄ RR loop: mission-linked event lookups ------------------------
// The single event published from a mission (most recent wins if re-published).
const selectEventByMission = db.prepare('SELECT * FROM events WHERE mission_id = ? ORDER BY created_at DESC LIMIT 1');
export function getEventByMission(missionId) {
  if (!missionId) return null;
  return parseEvent(selectEventByMission.get(Number(missionId)));
}

// Signups shaped for the planner share feed: includes the member's NAME and
// modex (getEventSignups omits name), plus the role_label so the share endpoint
// can group seats back onto their flight. Guests (member_id null) fall back to
// display_name. Seat order = sign-up time.
const selectEventSignupsForShare = db.prepare(`
  SELECT s.role_label, s.member_id, s.display_name, s.source,
         m.name, m.callsign, m.modex, m.livery
  FROM event_signups s
  LEFT JOIN members m ON m.id = s.member_id
  WHERE s.event_id = ?
  ORDER BY s.created_at ASC, s.id ASC
`);
export function getEventSignupsForShare(eventId) {
  return selectEventSignupsForShare.all(eventId);
}

const setEventResultStmt = db.prepare('UPDATE events SET result_summary = ?, updated_at = ? WHERE id = ?');
export function setEventResult(eventId, summary) {
  setEventResultStmt.run(summary ? String(summary).slice(0, 4000) : null, Date.now(), eventId);
}

// Record a post-mission result pushed from the planner (hop 7 of the OPT ⇄ RR
// loop). `participants` = [{ pilot, callsign, modex }] — the pilots who flew.
// Each is matched to a roster member, FIRST against this event's sign-ups (the
// names round-trip from the share feed) then via the pilot-alias bridge, and
// marked PRESENT. Stores the free-text summary. Returns marked vs unmatched
// labels so the caller can report coverage.
export function recordMissionResult(event, participants, summary) {
  const signups = getEventSignupsForShare(event.id);
  const norm = (s) => String(s || '').trim().toLowerCase();
  const marked = [];
  const unmatched = [];
  for (const p of (Array.isArray(participants) ? participants : []).slice(0, 200)) {
    const pilot = norm(p.pilot || p.name);
    const callsign = norm(p.callsign);
    const modex = norm(p.modex);
    let memberId = null;
    const hit = signups.find((s) => s.member_id != null && (
      (pilot && (norm(s.name) === pilot || norm(s.display_name) === pilot || norm(s.callsign) === pilot)) ||
      (callsign && norm(s.callsign) === callsign) ||
      (modex && norm(s.modex) === modex)
    ));
    if (hit) memberId = hit.member_id;
    if (!memberId && (p.pilot || p.name)) memberId = resolveAlias(p.pilot || p.name);
    const label = p.callsign || p.pilot || p.name || '?';
    if (memberId) {
      try { markAttendance(event.id, memberId, 'present', { recordedBy: 'opt-aar' }); marked.push(label); }
      catch { unmatched.push(label); }
    } else {
      unmatched.push(label);
    }
  }
  if (summary != null) setEventResult(event.id, summary);
  return { marked, unmatched };
}

// Shared claim/toggle for a single slot — used by BOTH the site sign-up
// endpoint and the Ops Bot sync endpoint so the rules (toggle off if already
// in the slot, respect the cap, one-slot-per-person unless multi) are identical
// on both sides. Qual-gating is enforced by the caller (it needs the roster).
// `event` must be a parsed event (roles as an array). Returns:
//   { changed, removed?, error? }   error ∈ { unknown_role, slot_full, missing_user }
export function claimEventSlot(event, { discord_user_id, member_id = null, display_name = null, role_label, source = 'site' }) {
  if (!discord_user_id) return { changed: false, error: 'missing_user' };
  const uid = String(discord_user_id);
  const role = (event.roles || []).find((r) => r.label === role_label);
  if (!role) return { changed: false, error: 'unknown_role' };
  const alreadyIn = getEventSignups(event.id).some((s) => s.discord_user_id === uid && s.role_label === role_label);
  if (alreadyIn) {
    removeEventSignup(event.id, role_label, uid);
    return { changed: true, removed: true };
  }
  if (role.limit && countEventRoleSignups(event.id, role_label) >= role.limit) {
    return { changed: false, error: 'slot_full' };
  }
  if (!event.multi_squadron) removeAllEventSignupsForUser(event.id, uid);
  setEventSignup(event.id, { role_label, discord_user_id: uid, member_id, display_name, source });
  return { changed: true };
}
export function deleteEvent(id) {
  return deleteEventStmt.run(id).changes;
}

const setEventDiscordStmt = db.prepare(
  'UPDATE events SET discord_channel_id = ?, discord_message_id = ? WHERE id = ?'
);
export function setEventDiscord(id, channelId, messageId) {
  setEventDiscordStmt.run(channelId || null, messageId || null, id);
}

const setEventPostAtStmt = db.prepare('UPDATE events SET discord_post_at = ? WHERE id = ?');
// Schedule (or clear) when this event should auto-post to Discord. null = never.
export function setEventPostAt(id, ms) {
  setEventPostAtStmt.run(Number.isFinite(ms) ? ms : null, id);
}
// Events whose scheduled post time has arrived and that haven't been posted yet.
const selectDueEvents = db.prepare(`
  SELECT * FROM events
  WHERE discord_post_at IS NOT NULL AND discord_post_at <= ? AND discord_message_id IS NULL
  ORDER BY discord_post_at ASC LIMIT 50
`);
export function getEventsDueForDiscord(now) {
  return selectDueEvents.all(now).map(parseEvent);
}

// --- list events in a range (for calendar) ------------------------------
const SEATS_FILLED = '(SELECT COUNT(*) FROM event_signups s WHERE s.event_id = events.id) AS seats_filled';
// squadron_tag rides along for consumers that label events (Discord digest).
const selectEventsInRange = db.prepare(`
  SELECT events.*, sq.tag AS squadron_tag, ${SEATS_FILLED} FROM events
  LEFT JOIN squadrons sq ON sq.id = events.squadron_id
  WHERE events.wing_id = ? AND events.start_at >= ? AND events.start_at < ?
  ORDER BY events.start_at ASC
`);
const selectEventsBySquadronInRange = db.prepare(`
  SELECT events.*, sq.tag AS squadron_tag, ${SEATS_FILLED} FROM events
  LEFT JOIN squadrons sq ON sq.id = events.squadron_id
  WHERE events.wing_id = ? AND events.start_at >= ? AND events.start_at < ?
    AND (events.squadron_id = ? OR events.multi_squadron = 1)
  ORDER BY events.start_at ASC
`);

export function getEventsInRange(wingId, fromMs, toMs, { squadronId } = {}) {
  const rows = squadronId
    ? selectEventsBySquadronInRange.all(wingId, fromMs, toMs, squadronId)
    : selectEventsInRange.all(wingId, fromMs, toMs);
  return rows.map((r) => {
    const ev = parseEvent(r);
    ev.seats_total = (ev.roles || []).reduce((n, role) => n + (role.limit || 0), 0);
    ev.seats_filled = r.seats_filled || 0;
    return ev;
  });
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
  SELECT a.member_id, a.status, a.recorded_at, a.notes, a.recorded_by,
         m.callsign, m.modex, m.name, m.squadron_id, sq.tag AS sqn_tag,
         rb.callsign AS recorded_by_callsign, rb.name AS recorded_by_name
  FROM event_attendance a
  JOIN members m ON m.id = a.member_id
  LEFT JOIN squadrons sq ON sq.id = m.squadron_id
  LEFT JOIN members rb ON rb.discord_user_id = a.recorded_by
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
const updateLOADetailsStmt = db.prepare('UPDATE loa_requests SET start_at = ?, end_at = ?, reason = ?, updated_at = ? WHERE id = ?');
// Edit an LOA's dates/reason (distinct from approve/deny, which is setLOAStatus).
export function updateLOA(id, { start_at, end_at, reason }) {
  const cur = selectLOA.get(id);
  if (!cur) return null;
  updateLOADetailsStmt.run(
    Number.isFinite(start_at) ? start_at : cur.start_at,
    Number.isFinite(end_at) ? end_at : cur.end_at,
    reason !== undefined ? (reason || null) : cur.reason,
    Date.now(), id,
  );
  return selectLOA.get(id);
}
export function deleteLOA(id) { return deleteLOAStmt.run(id).changes; }
// sinceMs lets the calendar pull LOAs that overlap a past month; default stays
// "still relevant" (ended less than a day ago) for the dashboard panel.
export function getUpcomingLOAs(wingId, sinceMs = null) {
  return selectWingLOAs.all(wingId, Number.isFinite(sinceMs) ? sinceMs : Date.now() - 86400000);
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

// --- squadron-scoped variants: same metrics over ONE squadron's members'
// attendance (join members, filter squadron_id). ---
const countEventsInRangeSqn = db.prepare(`
  SELECT COUNT(DISTINCT a.event_id) AS n
  FROM event_attendance a JOIN events e ON e.id = a.event_id JOIN members m ON m.id = a.member_id
  WHERE e.wing_id = ? AND e.start_at >= ? AND e.start_at < ? AND e.track_attendance = 1 AND m.squadron_id = ?
`);
const countAttendanceByStatusSqn = db.prepare(`
  SELECT a.status, COUNT(*) AS n
  FROM event_attendance a JOIN events e ON e.id = a.event_id JOIN members m ON m.id = a.member_id
  WHERE e.wing_id = ? AND e.start_at >= ? AND e.start_at < ? AND e.track_attendance = 1 AND m.squadron_id = ?
  GROUP BY a.status
`);
const countPilotsTrackedSqn = db.prepare(`
  SELECT COUNT(DISTINCT a.member_id) AS n
  FROM event_attendance a JOIN events e ON e.id = a.event_id JOIN members m ON m.id = a.member_id
  WHERE e.wing_id = ? AND e.start_at >= ? AND e.start_at < ? AND m.squadron_id = ?
`);
const selectPilotPerformanceSqn = db.prepare(`
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
  WHERE m.wing_id = ? AND m.squadron_id = ? AND m.status != 'retired'
  GROUP BY m.id
  HAVING events > 0
  ORDER BY m.modex ASC, m.callsign ASC
`);
const selectTimeseriesSqn = db.prepare(`
  SELECT e.id, e.title, e.kind, e.start_at,
    SUM(CASE WHEN ea.status = 'present'      THEN 1 ELSE 0 END) AS present,
    SUM(CASE WHEN ea.status = 'extra_credit' THEN 1 ELSE 0 END) AS extra_credit,
    SUM(CASE WHEN ea.status = 'excused'      THEN 1 ELSE 0 END) AS excused,
    SUM(CASE WHEN ea.status = 'ua'           THEN 1 ELSE 0 END) AS ua,
    SUM(CASE WHEN ea.status = 'absent'       THEN 1 ELSE 0 END) AS absent
  FROM events e
  LEFT JOIN event_attendance ea ON ea.event_id = e.id
    AND ea.member_id IN (SELECT id FROM members WHERE squadron_id = ?)
  WHERE e.wing_id = ? AND e.start_at BETWEEN ? AND ? AND e.track_attendance = 1
  GROUP BY e.id
  HAVING COUNT(ea.member_id) > 0
  ORDER BY e.start_at ASC
`);

export function getAttendanceMetrics(wingId, fromMs, toMs, { squadronId } = {}) {
  const events_tracked = squadronId
    ? countEventsInRangeSqn.get(wingId, fromMs, toMs, squadronId).n
    : countEventsInRange.get(wingId, fromMs, toMs).n;
  const byStatus = Object.fromEntries(
    (squadronId
      ? countAttendanceByStatusSqn.all(wingId, fromMs, toMs, squadronId)
      : countAttendanceByStatus.all(wingId, fromMs, toMs)).map((r) => [r.status, r.n])
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
    pilots_tracked: squadronId
      ? countPilotsTrackedSqn.get(wingId, fromMs, toMs, squadronId).n
      : countPilotsTracked.get(wingId, fromMs, toMs).n,
    attendance_rate,                    // percent (one decimal)
    present, extra_credit: extra, excused, ua_instances: ua, absent,
  };
}

// Per-event attendance for charting. One row per tracked event in the
// window, with attendance counts + computed rate. Returned newest-first.
const selectAttendanceTimeseries = db.prepare(`
  SELECT e.id, e.title, e.kind, e.start_at,
    SUM(CASE WHEN ea.status = 'present'      THEN 1 ELSE 0 END) AS present,
    SUM(CASE WHEN ea.status = 'extra_credit' THEN 1 ELSE 0 END) AS extra_credit,
    SUM(CASE WHEN ea.status = 'excused'      THEN 1 ELSE 0 END) AS excused,
    SUM(CASE WHEN ea.status = 'ua'           THEN 1 ELSE 0 END) AS ua,
    SUM(CASE WHEN ea.status = 'absent'       THEN 1 ELSE 0 END) AS absent
  FROM events e
  LEFT JOIN event_attendance ea ON ea.event_id = e.id
  WHERE e.wing_id = ? AND e.start_at BETWEEN ? AND ? AND e.track_attendance = 1
  GROUP BY e.id
  ORDER BY e.start_at ASC
`);
export function getAttendanceTimeseries(wingId, fromMs, toMs, { squadronId } = {}) {
  const rows = squadronId
    ? selectTimeseriesSqn.all(squadronId, wingId, fromMs, toMs)
    : selectAttendanceTimeseries.all(wingId, fromMs, toMs);
  return rows.map((r) => {
    const total = (r.present || 0) + (r.extra_credit || 0) + (r.excused || 0) + (r.ua || 0) + (r.absent || 0);
    const attended = (r.present || 0) + (r.extra_credit || 0);
    return {
      ...r,
      total_marks: total,
      attendance_rate: total ? Math.round((attended / total) * 1000) / 10 : 0,
    };
  });
}

export function getPilotPerformance(wingId, fromMs, toMs, { squadronId } = {}) {
  const rows = squadronId
    ? selectPilotPerformanceSqn.all(fromMs, toMs, wingId, squadronId)
    : selectPilotPerformance.all(fromMs, toMs, wingId);
  return rows.map((r) => {
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
