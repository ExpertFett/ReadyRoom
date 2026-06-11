/**
 * Server-side demo wing seeder.
 *
 * Composes existing DB helpers to populate a fully-fleshed-out wing in one
 * transaction. Used by POST /api/admin/seed-demo so a root admin can spin up
 * a polished demo wing on production in seconds, then delete it when done.
 *
 * Mirrors the content of the local seed-demo.mjs script, but inline DB calls
 * instead of HTTP roundtrips — much faster (sub-second) and works against
 * the live production DB.
 *
 * Owner becomes an admin member of the new wing automatically so they can
 * navigate to it via the standard /api/wings list (filtered by membership).
 */

import db from '../db/index.js';
import {
  createWing, createSquadron, createMember, createQual,
  setMemberQual, setModexPool,
  setWingOpsBot,
} from '../db/index.js';
import { setQualTier } from '../db/roster.js';
import { setQualCadence, signOffActivity } from '../db/quals.js';
import { createCarrier, recordTrap } from '../db/carrier.js';
import { createTrainingSession } from '../db/training.js';
import { createDocument } from '../db/docs.js';
import { createEvent, markAttendance } from '../db/events.js';

const NOW = () => Date.now();
const DAY = 86_400_000;

// Activities go through the quals.js path; declare here to keep linear flow.
const insertActivityStmt = db.prepare(
  `INSERT INTO qual_activities (qual_id, name, group_name, sort_order, created_at)
   VALUES (?, ?, ?, ?, ?)`
);
function addActivity(qualId, name, group, sortOrder) {
  return Number(insertActivityStmt.run(qualId, name, group, sortOrder, NOW()).lastInsertRowid);
}

const CANONICAL_OPS_BOT_URL = 'https://dcsoptbot-production-0c4b.up.railway.app';

/**
 * Spin up a new demo wing attached to `owner`. The owner's Discord ID is set
 * as the admin member so the wing shows up in their wings list via the
 * membership-scoped /api/wings filter.
 *
 * @param {{ discordUserId: string, username?: string }} owner
 * @returns {{ wing_id, summary: object }}
 */
export function seedDemoWing(owner) {
  if (!owner?.discordUserId) throw new Error('missing_owner');

  // ===== Wing =====
  const wing = createWing({
    name: 'Demo Wing — Carrier Air Wing One',
    tag: 'DEMO-CVW',
    description: 'Demo wing for product showcase. Fully populated roster, quals, events, carrier traps, training sessions, and docs. Delete when finished.',
    created_by: owner.discordUserId,   // the admin who seeded it owns it (shows in their switcher)
  });
  const wingId = wing.id;

  // ===== Quals (5, with rich descriptions) =====
  const iqt = createQual(wingId, {
    code: 'IQT', name: 'Initial Qualification Training',
    description: 'Initial Qualification Training — foundational airwork, instruments, formation, and pattern work. Required for all newly assigned pilots before progressing to carrier qualification. Typical duration: 6-8 weeks from assignment.',
    is_basic: true, is_currency: false, is_wing_wide: true,
    completion_deadline_days: 60,
  });
  setQualTier(iqt.id, { is_tier: true, tier_order: 1, tier_label: 'IQT' });

  const cq = createQual(wingId, {
    code: 'CQ', name: 'Carrier Qualified',
    description: 'Carrier Qualification — Case I, II, and III recovery procedures, marshall stack management, departure contracts, and tanker procedures. Includes night day-and-night qualification for unrestricted operations. 180-day currency.',
    is_currency: true, is_wing_wide: true,
  });
  setQualTier(cq.id, { is_tier: true, tier_order: 2, tier_label: 'CQ' });
  setQualCadence(cq.id, { currency_days: 180, completion_days: null });

  const mcq = createQual(wingId, {
    code: 'MCQ', name: 'Mission Capable',
    description: 'Mission Capable Qualification — basic wingman duties, division formation, basic SAM threat reaction, AAR. Pilots holding MCQ can fly as #2 in a section under a qualified flight lead. 90-day currency.',
    is_currency: true, is_wing_wide: true,
  });
  setQualTier(mcq.id, { is_tier: true, tier_order: 3, tier_label: 'MCQ' });
  setQualCadence(mcq.id, { currency_days: 90, completion_days: null });

  const cmq = createQual(wingId, {
    code: 'CMQ', name: 'Combat Mission Qual',
    description: 'Combat Mission Qual / Full Mission Qualified — section lead, division lead, advanced tactics, multi-threat environments, dynamic targeting. The top of the standard progression. 60-day currency on combat employment proficiency.',
    is_currency: true, is_wing_wide: true,
  });
  setQualTier(cmq.id, { is_tier: true, tier_order: 4, tier_label: 'FMQ' });
  setQualCadence(cmq.id, { currency_days: 60, completion_days: null });

  const sead = createQual(wingId, {
    code: 'SEAD', name: 'Advanced SEAD',
    description: 'Advanced SEAD — Suppression of Enemy Air Defenses. Covers all common IADS components (SA-2 / SA-11 / SA-17 / SA-10 / SA-15 family), tactical planning against threat overlap, HARM employment profiles, and SEAD escort. Wing-wide qual; opt-in.',
    is_wing_wide: true,
  });

  // ===== Activities (IQT 10, MCQ 6, CQ 5, SEAD 10) =====
  const iqtActs = [
    addActivity(iqt.id, 'Cold Start',           'Procedures', 1),
    addActivity(iqt.id, 'Ground Handling',      'Procedures', 2),
    addActivity(iqt.id, 'Running Rendezvous',   'Formation',  3),
    addActivity(iqt.id, 'CV Rendezvous',        'Formation',  4),
    addActivity(iqt.id, 'TACAN & Waypoint Nav', 'Navigation', 5),
    addActivity(iqt.id, 'Visual Nav Low Alt',   'Navigation', 6),
    addActivity(iqt.id, 'Parade Formation',     'Formation',  7),
    addActivity(iqt.id, 'Cruise Formation',     'Formation',  8),
    addActivity(iqt.id, 'Pattern & Landing',    'Procedures', 9),
    addActivity(iqt.id, 'IQT Check Ride',       'Check',     10),
  ];
  for (let i = 1; i <= 5; i++) {
    addActivity(cq.id, ['Case 1 Recovery', 'Case 3 Recovery', 'Marshall Stack', 'Departure Contract', 'Tanker Plug'][i-1],
      ['Recovery', 'Recovery', 'Approach', 'Departure', 'Tanker'][i-1], i);
  }
  const mcqActs = [
    addActivity(mcq.id, 'Wingman Duties',     'Basic',     1),
    addActivity(mcq.id, 'Section Formation',  'Formation', 2),
    addActivity(mcq.id, 'Division Formation', 'Formation', 3),
    addActivity(mcq.id, 'SAM Threat Reaction','Tactics',   4),
    addActivity(mcq.id, 'Basic AAR',          'Tanker',    5),
    addActivity(mcq.id, 'MCQ Check Ride',     'Check',     6),
  ];
  for (let i = 1; i <= 10; i++) {
    addActivity(sead.id, [
      'Welcome & Fundamentals', 'Threat: IADS Intro', 'SA-2, SA-11, SA-17',
      'SA-15, TacComm', 'SA-10s & SA-20s', 'SA-6 Persian Gulf 1/2',
      'Planning & Execution', 'Fly Mission Gulf 2/2', 'Qual Mission Planning', 'Qualification',
    ][i-1], ['Intro','Threats','Threats','Threats','Threats','Threats','Tactics','Mission','Check','Check'][i-1], i);
  }

  // ===== Squadrons =====
  const vf1 = createSquadron(wingId, { name: 'Wolfpack', tag: 'VF-1', aircraft: 'F-14B Tomcat' });
  const vmgr = createSquadron(wingId, { name: 'C-130 Det', tag: 'VMGR-352', aircraft: 'C-130J' });
  // Mark VMGR as a detachment via setSquadronKind would be ideal; pass kind in createSquadron payload.
  db.prepare('UPDATE squadrons SET kind = ? WHERE id = ?').run('detachment', vmgr.id);
  const vfc = createSquadron(wingId, { name: 'Aggressors', tag: 'VFC-12', aircraft: 'F-5E' });

  // ===== Members (owner + 24 demo pilots) =====
  // Owner: admin role. Link the Discord ID only if it isn't already on a
  // member row elsewhere (members.discord_user_id is a GLOBAL unique index;
  // a user can only be a member of one wing at a time). If they have an
  // existing primary wing, leave the demo owner's Discord field null —
  // root admins see all wings anyway and can navigate to this one.
  const existingDiscordMember = db.prepare(
    'SELECT 1 FROM members WHERE discord_user_id = ? LIMIT 1'
  ).get(owner.discordUserId);
  const ownerMember = createMember(wingId, {
    squadron_id: vf1.id,
    discord_user_id: existingDiscordMember ? null : owner.discordUserId,
    callsign: 'Fett', name: owner.username || 'Wing CO',
    modex: '415', rank: 'Maj', billet: 'CO',
    app_role: 'admin', subdivision: 'main', capabilities: 'IP,LSO',
  });

  // VF-1 Wolfpack — main roster
  const main = [
    ['Maverick',  'Pete Mitchell',   '400', 'LT',   'Pilot',  null],
    ['Goose',     'Nick Bradshaw',   '401', 'LTJG', 'RIO',    null],
    ['Iceman',    'Tom Kazansky',    '402', 'LT',   'OPSO',   null],
    ['Arcolepsy', 'Sam Reyes',       '405', 'Maj',  'OPSO',   null],
    ['Red3',      'Vince Cole',      '403', 'Capt', 'PAIO',   'JTAC'],
    ['Pending',   'Carter Reese',    '404', 'Capt', 'Pilot',  null],
    ['Fever',     'Alex Drake',      '406', 'Maj',  'Pilot',  'IP'],
    ['Backdoor',  'Jamie Foster',    '407', 'Capt', 'Pilot',  null],
    ['OpSec',     'Riley Banks',     '408', 'Capt', 'Pilot',  null],
    ['Marvin',    'Mara Lee',        '411', 'Maj',  'AOPSO',  'LSO'],
    ['Stuka',     'Erik Hansen',     '413', 'Capt', 'Pilot',  null],
    ['Badger',    'Quinn Parker',    '414', '1stLt','Pilot',  null],
    ['Gatekeeper','Tess Ortiz',      '416', '1stLt','Pilot',  null],
    ['Dump',      'Sky Cooper',      '417', 'Capt', 'Pilot',  null],
  ];
  const mainIds = main.map(([cs, n, modex, rank, billet, caps]) =>
    createMember(wingId, { squadron_id: vf1.id, callsign: cs, name: n, modex, rank, billet, capabilities: caps, subdivision: 'main' }).id);

  // Viper — commander on ready reserve
  const viper = createMember(wingId, {
    squadron_id: vf1.id, callsign: 'Viper', name: 'Mike Metcalf',
    modex: '420', rank: 'CDR', billet: 'Instructor',
    app_role: 'commander', subdivision: 'ready_reserve', capabilities: 'IP',
  });
  const jaba = createMember(wingId, {
    squadron_id: vf1.id, callsign: 'JABA', name: 'Niko Bell',
    modex: '421', rank: '1stLt', billet: 'Pilot', subdivision: 'ready_reserve',
  });
  const porkins = createMember(wingId, {
    squadron_id: vf1.id, callsign: 'Porkins', name: 'Logan Kim',
    modex: '422', rank: '1stLt', billet: 'Pilot', subdivision: 'ready_reserve',
  });

  // FRS students
  const herk = createMember(wingId, {
    squadron_id: vf1.id, callsign: 'Herk', name: 'River Stone',
    modex: '453', rank: '2ndLt', billet: 'Student', subdivision: 'frs',
  });
  const welcome = createMember(wingId, {
    squadron_id: vf1.id, callsign: 'Welcome', name: 'Sasha Park',
    modex: '451', rank: '2ndLt', billet: 'Student', subdivision: 'frs',
  });

  // Candidates
  const cambam = createMember(wingId, {
    squadron_id: vf1.id, callsign: 'CamBam', name: 'Devon Yu',
    modex: '462', rank: 'MIDN', billet: 'Candidate', subdivision: 'candidate',
  });
  const vike = createMember(wingId, {
    squadron_id: vf1.id, callsign: 'Vike', name: 'Andie Vale',
    modex: '464', rank: 'MIDN', billet: 'Candidate', subdivision: 'candidate',
  });
  const hollywood = createMember(wingId, {
    squadron_id: vf1.id, callsign: 'Hollywood', name: 'Rick Neven',
    modex: '463', rank: '1stLt', billet: 'Student', subdivision: 'candidate',
  });

  // VMGR-352 detachment
  const fifi = createMember(wingId, {
    squadron_id: vmgr.id, callsign: 'FiFi', name: 'Sarah Kerrigan',
    modex: '250', rank: 'Maj', billet: 'DET OIC', subdivision: 'main',
  });

  // VFC-12 Aggressor
  const spike = createMember(wingId, {
    squadron_id: vfc.id, callsign: 'Spike', name: 'Quinn Vetter',
    modex: '430', rank: 'LCdr', billet: 'AO', subdivision: 'main',
  });

  // ===== Qualifications awarded =====
  const setQ = (memberId, qualId) => setMemberQual(memberId, qualId, {
    status: 'qualified', awarded_at: NOW() - 30 * DAY, expires_at: null,
  });

  const [mavId, gooseId, iceId, arcId, red3Id, pendId, fevId, bdId, opsecId, marvinId, stukaId, badgerId, gateId, dumpId] = mainIds;
  // Full tier holders
  for (const m of [ownerMember.id, mavId, iceId, arcId, fevId, marvinId]) {
    for (const q of [iqt.id, cq.id, mcq.id, cmq.id]) setQ(m, q);
  }
  // Partial
  for (const m of [gooseId, viper.id, stukaId, bdId, red3Id, opsecId, pendId, dumpId]) {
    for (const q of [iqt.id, cq.id, mcq.id]) setQ(m, q);
  }
  // Just IQT (.id on the row objects)
  for (const m of [badgerId, gateId, jaba.id, porkins.id, hollywood.id]) setQ(m, iqt.id);
  // SEAD additions
  for (const m of [ownerMember.id, fevId, mavId, marvinId, red3Id, bdId]) setQ(m, sead.id);

  // ===== Activity sign-offs =====
  // Owner + full tier holders: every IQT + every CQ + every MCQ activity
  const allFullIqt = [ownerMember.id, mavId, iceId, arcId, fevId, marvinId, stukaId];
  for (const m of allFullIqt) {
    for (const a of iqtActs) signOffActivity(m, a, { status: 'signed', signerId: ownerMember.id });
    for (const a of mcqActs) signOffActivity(m, a, { status: 'signed', signerId: ownerMember.id });
  }
  // Partial IQT (7/10)
  for (const m of [red3Id, pendId, bdId, opsecId, dumpId, jaba.id]) {
    for (const a of iqtActs.slice(0, 7)) signOffActivity(m, a, { status: 'signed', signerId: ownerMember.id });
  }
  // Early IQT (3/10)
  for (const a of iqtActs.slice(0, 3)) signOffActivity(badgerId, a, { status: 'signed', signerId: ownerMember.id });
  for (const a of iqtActs.slice(0, 2)) signOffActivity(welcome.id, a, { status: 'signed', signerId: ownerMember.id });

  // ===== Modex pools =====
  setModexPool(wingId, 'main',          { range_start: 400, range_end: 419, notes: 'Active duty fleet roster' });
  setModexPool(wingId, 'ready_reserve', { range_start: 420, range_end: 439, notes: 'Ready reserve / on-call' });
  setModexPool(wingId, 'frs',           { range_start: 450, range_end: 459, notes: 'Fleet Replacement Squadron students' });
  setModexPool(wingId, 'candidate',     { range_start: 460, range_end: 467, notes: 'Pre-IQT candidates / midshipmen' });

  // ===== Carrier + traps =====
  const carr = createCarrier(wingId, {
    name: 'USS Theodore Roosevelt', hull: 'CVN-71', class: 'Nimitz', brc: 30,
    notes: 'Big stick. Primary recovery deck for CVW-1.',
  });
  const trap = (mid, grade, wire, daysAgo, com = '') => recordTrap(carr.id, {
    member_id: mid, airframe: 'F/A-18C', grade, wire,
    aoa: 'OK', lineup: 'OK', glideslope: 'OK',
    time_at: NOW() - daysAgo * DAY, comments: com,
  }, ownerMember.id);
  // Owner — strong
  for (const [g, w, d] of [['_OK_',4,80,'Perfect pass'],['OK',3,70],['OK',3,60],['(OK)',2,50],['OK',3,40],['OK',3,30],['OK',3,20],['_OK_',4,10]])
    trap(ownerMember.id, g, w, d);
  // Maverick
  for (const [g, w, d, c] of [['OK',3,75],['B',0,65,'Pwr off in close'],['(OK)',2,55],['OK',3,45],['OK',3,35],['WO',0,25,'Wave off settle'],['OK',3,15]])
    trap(mavId, g, w, d, c || '');
  // Arcolepsy
  for (const [g, w, d] of [['(OK)',2,60],['OK',3,50],['B',0,40],['OK',3,30],['(OK)',2,20]])
    trap(arcId, g, w, d);
  // Iceman
  for (const [g, w, d] of [['OK',3,60],['OK',3,50],['_OK_',4,40],['(OK)',2,25]])
    trap(iceId, g, w, d);
  // Fever + Stuka
  trap(fevId, 'OK', 3, 55); trap(fevId, 'OK', 3, 40);
  trap(stukaId, '(OK)', 2, 50); trap(stukaId, 'B', 0, 30, 'Bolter, came back'); trap(stukaId, 'OK', 3, 20);

  // ===== Training sessions =====
  const tsess = (pilot, instructor, days, mins, topics, qid) => createTrainingSession(wingId, {
    pilot_member_id: pilot, instructor_member_id: instructor, qual_id: qid,
    started_at: NOW() - days * DAY, duration_minutes: mins, topics, notes: '',
  }, ownerMember.id);
  tsess(welcome.id, fevId,         18, 90, 'IQT Cold Start, ground handling',     iqt.id);
  tsess(welcome.id, fevId,         10, 90, 'IQT pattern work + landings',         iqt.id);
  tsess(welcome.id, fevId,          3, 60, 'IQT formation review',                iqt.id);
  tsess(cambam.id,  fevId,         20, 75, 'IQT intro to procedures',             iqt.id);
  tsess(cambam.id,  fevId,          5, 90, 'IQT navigation + checklist',          iqt.id);
  tsess(vike.id,    fevId,          8, 60, 'IQT pattern entry',                   iqt.id);
  tsess(herk.id,    ownerMember.id,12, 75, 'MCQ wingman duties + AAR',            mcq.id);
  tsess(porkins.id, ownerMember.id,14, 60, 'CQ Case I procedures',                cq.id);
  tsess(jaba.id,    marvinId,       6, 75, 'CQ LSO debrief + corrections',        cq.id);

  // ===== Documents =====
  const doc = (scope, scopeId, title, content) => createDocument(wingId, {
    scope, scope_id: scopeId, title, content,
  }, owner.discordUserId);
  doc('wing', null, 'Wing SOP — Communications',
    `# Wing-wide Communications SOP\n\nAll inbound CAS check-ins on Strike. Wingman comms on tactical. Visual range = call "tally." Beyond visual = call "judy" with bearing/range.\n\n## Frequencies\n- Strike: 256.0\n- Tactical: 240.0\n- Tanker: 244.0\n- Marshall: 254.0\n\n## Brevity\nStandard NATO brevity. No squawk-and-talk on tactical.`);
  doc('wing', null, 'Wing SOP — Emergency Procedures',
    `# Emergency Procedures\n\n## Bingo\nDeclare bingo immediately. State fuel + intentions.\n\n## Hung Ordnance\nClear vector to safe jettison area. RTB only after confirmed safe.\n\n## Lost Comms\nSquawk 7600. Continue to last assigned waypoint. Visual rejoin.`);
  doc('squadron', vf1.id, 'VF-1 Wolfpack — Section Lead Standards',
    `# Section Lead Expectations\n\n## Pre-mission\n- Brief contract with wing\n- Verify fuel ladder + bingo number\n- Confirm tanker availability\n\n## In-flight\n- Maintain contract\n- Update wing every fuel state\n- Call merge / commit per ROE`);
  doc('qual', iqt.id, 'IQT Study Guide',
    `# IQT Curriculum\n\n## Phase 1: Procedures (weeks 1-2)\nCold start, ground handling, taxi, takeoff, basic instruments.\n\n## Phase 2: Formation (weeks 3-4)\nRunning rendezvous, CV rendezvous, parade, cruise.\n\n## Phase 3: Navigation (weeks 5-6)\nTACAN, waypoint nav, low alt visual nav.\n\n## Phase 4: Check Ride (week 7)\nFull profile flight evaluating all prior phases.`);
  doc('qual', cq.id, 'CQ Study Guide',
    `# Carrier Qualification\n\n## Case I (VFR day)\nMarshall stack at the IP. 250kts. Break at 800ft AGL. Downwind, abeam, into the groove, ball call: callsign + type + ball + fuel.\n\n## Case II (Marginal VFR)\nApproach mostly Case I but with cloud break management.\n\n## Case III (Night/IMC)\nFull ILS approach off marshall. Ball call same format.`);
  doc('qual', sead.id, 'Advanced SEAD — Threat Library',
    `# Threat IADS Reference\n\n## SA-2 family\nLegacy command-guidance. Long radar warning, predictable lethal envelope. Defeat via terrain masking + speed.\n\n## SA-11 / SA-17\nSemi-active. Fragmenting warhead. 30-40km lethal envelope. HARM-shoot before merge.\n\n## SA-10 / SA-20 family\nLong-range, high-PK. Stay outside lethal envelope or get inside engagement timeline.`);

  // ===== Cross-Squadron enrollment =====
  db.prepare(`INSERT INTO squadron_enrollments (squadron_id, member_id, notes, created_at)
             VALUES (?, ?, ?, ?)`)
    .run(vf1.id, spike.id, 'CQ refresher for cross-deck operations.', NOW());

  // ===== Events + attendance (historical + upcoming) =====
  const mkEv = (title, kind, daysOffset) => createEvent(wingId, {
    squadron_id: vf1.id, title, kind, start_at: NOW() + daysOffset * DAY,
    end_at: null, multi_squadron: false, track_attendance: true,
  }, owner.discordUserId);

  const mainPilots = [ownerMember.id, mavId, gooseId, iceId, viper.id, arcId, red3Id, pendId, fevId, bdId, opsecId, marvinId, stukaId];
  const historicalEvents = [];
  for (let w = 1; w <= 12; w++) {
    const days = -w * 7 + (w % 2 === 0 ? -3 : 0);
    const title = w % 3 === 0 ? `SEAD Practice ${w}`
                 : w % 2 === 0 ? `BFM Round ${w}`
                 : `General Training ${w}`;
    const ev = mkEv(title, 'squadron', days);
    historicalEvents.push(ev);
    // Realistic attendance distribution
    for (const mid of mainPilots) {
      const r = Math.random();
      const s = r < 0.7 ? 'present' : r < 0.82 ? 'extra_credit' : r < 0.92 ? 'excused' : r < 0.97 ? 'absent' : 'ua';
      try { markAttendance(ev.id, mid, s, { recordedBy: owner.discordUserId }); } catch {}
    }
  }
  // Upcoming
  mkEv('Operation Persian Sun',        'squadron',     3);
  mkEv('Case III Practice',            'squadron',     6);
  mkEv('Carrier Qual Refresher',       'squadron',    13);
  mkEv('Wing All-Hands',               'squadron',    17);
  mkEv('SEAD Qual Hop',                'extra_credit', 21);

  // ===== Wing OpsBot config (so Discord publish status panel shows wired) =====
  setWingOpsBot(wingId, {
    ops_bot_url: CANONICAL_OPS_BOT_URL,
    ops_bot_token: 'demo-placeholder-not-real',
  });

  return {
    wing_id: wingId,
    summary: {
      wing: 'Demo Wing — Carrier Air Wing One',
      members: 25,
      squadrons: 3,
      quals: 5,
      activities: 31,
      historical_events: historicalEvents.length,
      upcoming_events: 5,
      traps: 30,
      training_sessions: 9,
      documents: 6,
      cross_squadron_enrollments: 1,
      modex_pools: 4,
    },
  };
}
