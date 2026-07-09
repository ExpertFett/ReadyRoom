// CSV exporters for admin data portability (roster / attendance / quals).
// Returns plain CSV strings; the API layer sets headers + a UTF-8 BOM so Excel
// reads them correctly.

import { getMembersByWing, getSquadrons, getMemberQuals } from '../db/index.js';
import { getPilotPerformance } from '../db/events.js';

const cell = (v) => {
  if (v == null) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export function toCsv(headers, rows) {
  return [headers.map(cell).join(','), ...rows.map((r) => r.map(cell).join(','))].join('\r\n');
}
const day = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : '');

export function rosterCsv(wingId) {
  const sqTag = new Map(getSquadrons(wingId).map((s) => [s.id, s.tag || s.name]));
  const rows = getMembersByWing(wingId).map((m) => [
    m.modex, m.callsign, m.name, m.rank, m.billet,
    m.squadron_id ? (sqTag.get(m.squadron_id) || '') : '',
    m.subdivision, m.status, m.capabilities, day(m.joined_at),
  ]);
  return toCsv(['Modex', 'Callsign', 'Name', 'Rank', 'Billet', 'Squadron', 'Subdivision', 'Status', 'Capabilities', 'Joined'], rows);
}

export function attendanceCsv(wingId, fromMs, toMs) {
  const rows = getPilotPerformance(wingId, fromMs, toMs).map((p) => [
    p.callsign, p.modex, p.sqn_tag, p.events, p.present, p.extra_credit,
    p.excused, p.ua, p.attendance_rate, p.accountability,
  ]);
  return toCsv(['Callsign', 'Modex', 'Squadron', 'Events', 'Present', 'ExtraCredit', 'Excused', 'UA', 'AttendanceRate%', 'Accountability%'], rows);
}

export function qualsCsv(wingId) {
  const sqTag = new Map(getSquadrons(wingId).map((s) => [s.id, s.tag || s.name]));
  const rows = [];
  for (const m of getMembersByWing(wingId)) {
    for (const q of getMemberQuals(m.id)) {
      rows.push([
        m.callsign, m.modex, m.squadron_id ? (sqTag.get(m.squadron_id) || '') : '',
        q.code, q.name, q.status, day(q.awarded_at), day(q.expires_at),
      ]);
    }
  }
  return toCsv(['Callsign', 'Modex', 'Squadron', 'QualCode', 'QualName', 'Status', 'Awarded', 'Expires'], rows);
}
