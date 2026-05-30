import db from './index.js';

// Cross-attachment of members to detachments (a member organic to one squadron,
// attached part-time to a detachment, e.g. a VMFA pilot flying the C-130 det).
db.exec(`
  CREATE TABLE IF NOT EXISTS member_attachments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id   INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    squadron_id INTEGER NOT NULL REFERENCES squadrons(id) ON DELETE CASCADE,
    attach_type TEXT NOT NULL DEFAULT 'PT',   -- FT (organic) | PT (cross-attached)
    note        TEXT,
    created_at  INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_attach_member_sqn ON member_attachments (member_id, squadron_id);
  CREATE INDEX IF NOT EXISTS idx_attach_sqn ON member_attachments (squadron_id);
`);

export const SUBDIVISIONS = ['main', 'ready_reserve', 'candidate', 'frs'];
export const SUBDIVISION_LABELS = {
  main: 'Main', ready_reserve: 'Ready Reserve', candidate: 'Candidate', frs: 'FRS',
};

// --- squadron kind (squadron | detachment) -------------------------------
const setKindStmt = db.prepare('UPDATE squadrons SET kind = ? WHERE id = ?');
export function setSquadronKind(id, kind) {
  setKindStmt.run(kind === 'detachment' ? 'detachment' : 'squadron', id);
}

// --- qualification tier flags --------------------------------------------
const setQualTierStmt = db.prepare(
  'UPDATE quals SET is_tier = ?, tier_order = ?, tier_label = ? WHERE id = ?'
);
export function setQualTier(qualId, { is_tier, tier_order, tier_label }) {
  setQualTierStmt.run(
    is_tier ? 1 : 0,
    Number.isFinite(tier_order) ? tier_order : null,
    tier_label ? String(tier_label).slice(0, 20) : null,
    qualId
  );
}
const selectTierQuals = db.prepare('SELECT * FROM quals WHERE wing_id = ? AND is_tier = 1 ORDER BY tier_order ASC');
export function getTierQuals(wingId) {
  return selectTierQuals.all(wingId);
}

// --- readiness tier, derived from a member's achieved tier quals ---------
// Tier = the label of the highest-order tier qual the member is qualified in.
const selectMemberTier = db.prepare(`
  SELECT q.tier_label AS label
  FROM member_quals mq JOIN quals q ON q.id = mq.qual_id
  WHERE mq.member_id = ? AND mq.status = 'qualified' AND q.is_tier = 1
  ORDER BY q.tier_order DESC LIMIT 1
`);
export function computeMemberTier(memberId) {
  return selectMemberTier.get(memberId)?.label || null;
}

// qual codes a member holds (tier quals first) — for the roster QUALS column
const selectMemberQualCodes = db.prepare(`
  SELECT q.code FROM member_quals mq JOIN quals q ON q.id = mq.qual_id
  WHERE mq.member_id = ? AND mq.status = 'qualified'
  ORDER BY q.is_tier DESC, q.sort_order ASC, q.code ASC
`);
export function getMemberQualCodes(memberId) {
  return selectMemberQualCodes.all(memberId).map((r) => r.code);
}

const decorate = (m) => ({ ...m, tier: computeMemberTier(m.id), qual_codes: getMemberQualCodes(m.id) });

// --- roster grouped by subdivision (organic members) ---------------------
const selectOrganic = db.prepare(`
  SELECT * FROM members WHERE squadron_id = ? AND status != 'retired'
  ORDER BY modex ASC, callsign ASC
`);
export function getSquadronRoster(squadronId) {
  const members = selectOrganic.all(squadronId).map(decorate);
  return SUBDIVISIONS.map((key) => ({
    key,
    label: SUBDIVISION_LABELS[key],
    members: members.filter((m) => (m.subdivision || 'main') === key),
  }));
}

// readiness rollup: count organic members by computed tier
export function getSquadronReadiness(squadronId) {
  const members = selectOrganic.all(squadronId);
  const tiers = {};
  for (const m of members) {
    const t = computeMemberTier(m.id) || 'Untiered';
    tiers[t] = (tiers[t] || 0) + 1;
  }
  return { total: members.length, tiers };
}

// --- detachments ---------------------------------------------------------
const insertAttach = db.prepare(`
  INSERT INTO member_attachments (member_id, squadron_id, attach_type, note, created_at)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(member_id, squadron_id) DO UPDATE SET attach_type = excluded.attach_type, note = excluded.note
`);
const deleteAttachStmt = db.prepare('DELETE FROM member_attachments WHERE member_id = ? AND squadron_id = ?');
const selectAttached = db.prepare(`
  SELECT a.attach_type, a.note, m.*, sq.tag AS home_tag, sq.name AS home_name
  FROM member_attachments a
  JOIN members m ON m.id = a.member_id
  LEFT JOIN squadrons sq ON sq.id = m.squadron_id
  WHERE a.squadron_id = ?
  ORDER BY a.attach_type ASC, m.modex ASC
`);

export function attachMember(squadronId, memberId, attachType = 'PT', note = null) {
  insertAttach.run(memberId, squadronId, attachType === 'FT' ? 'FT' : 'PT', note, Date.now());
}
export function detachMember(squadronId, memberId) {
  return deleteAttachStmt.run(memberId, squadronId).changes;
}

// A detachment's roster = its organic members (FT) + cross-attached members (PT).
export function getDetachmentRoster(detId) {
  const organic = selectOrganic.all(detId).map((m) => ({ ...decorate(m), attach_type: 'FT', home_tag: null }));
  const attached = selectAttached.all(detId).map((m) => ({
    ...m, tier: computeMemberTier(m.id), qual_codes: getMemberQualCodes(m.id),
    attach_type: m.attach_type || 'PT',
  }));
  return [...organic, ...attached];
}
