// Throwaway demo seeder — run once against a fresh DB to populate all four epics.
import { readFileSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:4700';
let cookie = '';

async function call(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (cookie) headers.cookie = cookie;
  if (opts.body && typeof opts.body === 'object' && !(opts.body instanceof Uint8Array) && !(opts.body instanceof ArrayBuffer)) {
    headers['content-type'] = 'application/json';
    opts.body = JSON.stringify(opts.body);
  }
  const res = await fetch(BASE + path, { ...opts, headers, redirect: 'manual' });
  const set = res.headers.getSetCookie?.() || [];
  for (const c of set) {
    const m = c.match(/^([^=]+=[^;]+)/);
    if (m) cookie = m[1];
  }
  const ct = res.headers.get('content-type') || '';
  return ct.startsWith('application/json') ? res.json() : res.text();
}

const NOW = Date.now();
const DAY = 86400000;

await call('/auth/dev-login');

// Wing
await call('/api/wings', { method: 'POST', body: { name: 'Carrier Air Wing One', tag: 'CVW-1', description: 'Fightertown - forward-deployed naval aviation wing.' } });

// Tier quals
const iqt = (await call('/api/quals', { method: 'POST', body: { wing_id: 1, code: 'IQT', name: 'Initial Qual Training', is_tier: true, tier_order: 1, tier_label: 'IQT' } })).id;
const cq = (await call('/api/quals', { method: 'POST', body: { wing_id: 1, code: 'CQ', name: 'Carrier Qualified', is_tier: true, tier_order: 2, tier_label: 'CQ', currency_days: 180 } })).id;
const mcq = (await call('/api/quals', { method: 'POST', body: { wing_id: 1, code: 'MCQ', name: 'Mission Capable', is_tier: true, tier_order: 3, tier_label: 'MCQ', currency_days: 90 } })).id;
const cmq = (await call('/api/quals', { method: 'POST', body: { wing_id: 1, code: 'CMQ', name: 'Combat Mission Qual', is_tier: true, tier_order: 4, tier_label: 'FMQ', currency_days: 60 } })).id;
const sead = (await call('/api/quals', { method: 'POST', body: { wing_id: 1, code: 'SEAD', name: 'Advanced SEAD', category: 'Advanced', currency_days: 90 } })).id;

const activities = [];
for (const [i, name, group] of [[1, 'Case 1 Recovery'], [2, 'Case 3 Recovery'], [3, 'Marshall Stack', 'Approach'], [4, 'Departure Contract', 'Departure'], [5, 'Tanker Plug']]) {
  activities.push((await call(`/api/quals/${cq}/activities`, { method: 'POST', body: { name, group_name: group, sort_order: i } })).id);
}

// Squadron + members
await call('/api/squadrons', { method: 'POST', body: { wing_id: 1, name: 'Wolfpack', tag: 'VF-1', aircraft: 'F-14B Tomcat' } });
const mk = async (data) => (await call('/api/members', { method: 'POST', body: { wing_id: 1, squadron_id: 1, ...data } })).id;
const fett = await mk({ callsign: 'Fett', name: 'Garrett Dryden', modex: '415', rank: 'Maj', billet: 'CO', app_role: 'admin', discord_user_id: '100000000000000000', subdivision: 'main' });
const mav = await mk({ callsign: 'Maverick', name: 'Pete Mitchell', modex: '400', rank: 'LT', billet: 'Pilot', subdivision: 'main' });
const goose = await mk({ callsign: 'Goose', name: 'Nick Bradshaw', modex: '401', rank: 'LTJG', billet: 'RIO', subdivision: 'main' });
const ice = await mk({ callsign: 'Iceman', name: 'Tom Kazansky', modex: '402', rank: 'LT', billet: 'OPSO', subdivision: 'main' });
const viper = await mk({ callsign: 'Viper', name: 'Mike Metcalf', modex: '410', rank: 'CDR', billet: 'Instructor', subdivision: 'ready_reserve', app_role: 'commander' });
const holly = await mk({ callsign: 'Hollywood', name: 'Rick Neven', modex: '460', rank: '1stLt', subdivision: 'candidate' });

const setQ = (m, q) => call(`/api/members/${m}/quals/${q}`, { method: 'PUT', body: { status: 'qualified' } });
const fullTier = [iqt, cq, mcq, cmq];
for (const q of [...fullTier, sead]) await setQ(fett, q);
for (const q of [...fullTier, sead]) await setQ(mav, q);
for (const q of [iqt, cq, mcq]) await setQ(goose, q);
for (const q of fullTier) await setQ(ice, q);
for (const q of [iqt, cq]) await setQ(viper, q);
await setQ(holly, iqt);

// Activity sign-offs (drives auto-qualify + progress)
const sign = (m, a) => call(`/api/members/${m}/signoffs/${a}`, { method: 'POST', body: {} });
for (const a of activities) { await sign(fett, a); await sign(mav, a); await sign(ice, a); }
for (const a of activities.slice(0, 3)) await sign(goose, a);     // 3/5 -> training
for (const a of activities.slice(0, 4)) await sign(viper, a);     // 4/5 -> training

// Detachment
await call('/api/squadrons', { method: 'POST', body: { wing_id: 1, name: 'C-130 Det', tag: 'VMGR-352', aircraft: 'C-130J', kind: 'detachment' } });
await call('/api/members', { method: 'POST', body: { wing_id: 1, squadron_id: 2, callsign: 'FiFi', name: 'Sarah Kerrigan', rank: 'Maj', modex: '250' } });
await call('/api/squadrons/2/attach', { method: 'POST', body: { member_id: mav, attach_type: 'PT' } });
await call('/api/squadrons/2/attach', { method: 'POST', body: { member_id: ice, attach_type: 'PT' } });

// Events + attendance
const mkev = async (title, kind, days) => (await call('/api/events', { method: 'POST', body: { wing_id: 1, squadron_id: 1, title, kind, start_at: NOW + days * DAY } })).id;
const e1 = await mkev('SEAD Training', 'squadron', -21);
const e2 = await mkev('BFM Practice', 'squadron', -14);
const e3 = await mkev('Tanker Plug Bonus', 'extra_credit', -10);
const e4 = await mkev('IP Meeting', 'squadron', -7);
await mkev('Operation Persian Sun', 'squadron', 3);
await mkev('Case III Practice', 'squadron', 6);
await mkev('General Training', 'squadron', 13);

const att = (e, m, s) => call(`/api/events/${e}/attendance`, { method: 'POST', body: { member_id: m, status: s } });
await att(e1, fett, 'present'); await att(e1, mav, 'present'); await att(e1, goose, 'present'); await att(e1, ice, 'excused'); await att(e1, viper, 'ua');
await att(e2, fett, 'present'); await att(e2, mav, 'present'); await att(e2, goose, 'ua'); await att(e2, ice, 'present'); await att(e2, viper, 'present');
await att(e3, mav, 'extra_credit');
await att(e4, fett, 'present'); await att(e4, mav, 'present'); await att(e4, goose, 'present'); await att(e4, ice, 'present'); await att(e4, viper, 'absent');

// Mission with .miz-imported flights
await call('/api/missions', { method: 'POST', body: { wing_id: 1, name: 'Operation Thunder Strike', type: 'standalone', primary_aircraft: 'F-14B', status: 'planning', start_at: '2026-06-05T20:00', duration_min: 120, description: 'SEAD then strike on Kish. Tankers on Texaco.' } });
const miz = readFileSync('C:/Users/Fett/Saved Games/Claude Dump/Mizmaker/planner/backend/tests/fixtures/simple.miz');
await fetch(BASE + '/api/missions/1/import-miz', { method: 'POST', headers: { cookie, 'content-type': 'application/octet-stream' }, body: miz });
const m1 = await call('/api/missions/1');
if (m1.flights?.length) await call(`/api/flights/${m1.flights[0].id}/signup`, { method: 'POST', body: { member_id: mav } });

await call('/api/missions', { method: 'POST', body: { wing_id: 1, name: 'Fightertown CAP', type: 'campaign', primary_aircraft: 'F-14B', status: 'active', start_at: '2026-06-02T19:00', duration_min: 90 } });
await call('/api/missions', { method: 'POST', body: { wing_id: 1, name: 'Basic Fighter Maneuvers', type: 'library', primary_aircraft: 'F-14B', status: 'planning' } });

// LOA
await call(`/api/members/${viper}/loas`, { method: 'POST', body: { start_at: NOW + 5 * DAY, end_at: NOW + 12 * DAY, reason: 'Training detachment' } });

// =========================================================================
// Phase 1-4 demo content — qual descriptions, more activities + members,
// carriers + traps, training sessions, documents, modex pools, sorties,
// cross-squadron enrollment, more events.
// =========================================================================

// --- Qual descriptions (Phase 1 My Quals + Docs hub render these) ---
const upd = (id, body) => call(`/api/quals/${id}`, { method: 'PUT', body });
await upd(iqt, {
  description: 'Initial Qualification Training — foundational airwork, instruments, formation, and pattern work. Required for all newly assigned pilots before progressing to carrier qualification. Typical duration: 6-8 weeks from assignment.',
  is_basic: true, completion_deadline_days: 60,
});
await upd(cq, {
  description: 'Carrier Qualification — Case I, II, and III recovery procedures, marshall stack management, departure contracts, and tanker procedures. Includes night day-and-night qualification for unrestricted operations. 180-day currency.',
  is_currency: true,
});
await upd(mcq, {
  description: 'Mission Capable Qualification — basic wingman duties, division formation, basic SAM threat reaction, AAR. Pilots holding MCQ can fly as #2 in a section under a qualified flight lead. 90-day currency.',
  is_currency: true,
});
await upd(cmq, {
  description: 'Combat Mission Qual / Full Mission Qualified — section lead, division lead, advanced tactics, multi-threat environments, dynamic targeting. The top of the standard progression. 60-day currency on combat employment proficiency.',
  is_currency: true,
});
await upd(sead, {
  description: 'Advanced SEAD — Suppression of Enemy Air Defenses. Covers all common IADS components (SA-2 / SA-11 / SA-17 / SA-10 / SA-15 family), tactical planning against threat overlap, HARM employment profiles, and SEAD escort. Wing-wide qual; opt-in.',
});

// --- More activities for IQT + MCQ so the Training Board has substance ---
const addActivity = (qid, name, group, sort) =>
  call(`/api/quals/${qid}/activities`, { method: 'POST', body: { name, group_name: group, sort_order: sort } });

const iqtActs = [
  ['Cold Start',              'Procedures', 1],
  ['Ground Handling',         'Procedures', 2],
  ['Running Rendezvous',      'Formation',  3],
  ['CV Rendezvous',           'Formation',  4],
  ['TACAN & Waypoint Nav',    'Navigation', 5],
  ['Visual Nav Low Alt',      'Navigation', 6],
  ['Parade Formation',        'Formation',  7],
  ['Cruise Formation',        'Formation',  8],
  ['Pattern & Landing',       'Procedures', 9],
  ['IQT Check Ride',          'Check',      10],
];
const allIqtActs = [];
for (const [name, g, s] of iqtActs) {
  const a = await addActivity(iqt, name, g, s);
  if (a?.id) allIqtActs.push(a.id);
}

const mcqActs = [
  ['Wingman Duties',          'Basic',      1],
  ['Section Formation',       'Formation',  2],
  ['Division Formation',      'Formation',  3],
  ['SAM Threat Reaction',     'Tactics',    4],
  ['Basic AAR',               'Tanker',     5],
  ['MCQ Check Ride',          'Check',      6],
];
for (const [name, g, s] of mcqActs) await addActivity(mcq, name, g, s);

const seadActs = [
  ['Welcome & Fundamentals',  'Intro',      1],
  ['Threat: IADS Intro',      'Threats',    2],
  ['SA-2, SA-11, SA-17',      'Threats',    3],
  ['SA-15, TacComm',          'Threats',    4],
  ['SA-10s & SA-20s',         'Threats',    5],
  ['SA-6 Persian Gulf 1/2',   'Threats',    6],
  ['Planning & Execution',    'Tactics',    7],
  ['Fly Mission Gulf 2/2',    'Mission',    8],
  ['Qual Mission Planning',   'Check',      9],
  ['Qualification',           'Check',      10],
];
for (const [name, g, s] of seadActs) await addActivity(sead, name, g, s);

// --- More members across squadrons (rich roster for Bulk Migration + Personnel) ---
// VF-1 Wolfpack additions
const arc = await mk({ callsign: 'Arcolepsy', name: 'Sam Reyes',    modex: '405', rank: 'Maj',  billet: 'OPSO',     subdivision: 'main' });
const red = await mk({ callsign: 'Red3',      name: 'Vince Cole',   modex: '403', rank: 'Capt', billet: 'PAIO',     subdivision: 'main', capabilities: 'JTAC' });
const pen = await mk({ callsign: 'Pending',   name: 'Carter Reese', modex: '404', rank: 'Capt', billet: 'Pilot',    subdivision: 'main' });
const fev = await mk({ callsign: 'Fever',     name: 'Alex Drake',   modex: '406', rank: 'Maj',  billet: 'Pilot',    subdivision: 'main', capabilities: 'IP' });
const bd  = await mk({ callsign: 'Backdoor',  name: 'Jamie Foster', modex: '407', rank: 'Capt', billet: 'Pilot',    subdivision: 'main' });
const op  = await mk({ callsign: 'OpSec',     name: 'Riley Banks',  modex: '408', rank: 'Capt', billet: 'Pilot',    subdivision: 'main' });
const mar = await mk({ callsign: 'Marvin',    name: 'Mara Lee',     modex: '411', rank: 'Maj',  billet: 'AOPSO',    subdivision: 'main', capabilities: 'LSO' });
const stu = await mk({ callsign: 'Stuka',     name: 'Erik Hansen',  modex: '413', rank: 'Capt', billet: 'Pilot',    subdivision: 'main' });
const bad = await mk({ callsign: 'Badger',    name: 'Quinn Parker', modex: '414', rank: '1stLt',billet: 'Pilot',    subdivision: 'main' });
const gat = await mk({ callsign: 'Gatekeeper',name: 'Tess Ortiz',   modex: '416', rank: '1stLt',billet: 'Pilot',    subdivision: 'main' });
const dmp = await mk({ callsign: 'Dump',      name: 'Sky Cooper',   modex: '417', rank: 'Capt', billet: 'Pilot',    subdivision: 'main' });
// Ready Reserve
const jaba = await mk({ callsign: 'JABA',     name: 'Niko Bell',    modex: '421', rank: '1stLt',billet: 'Pilot',    subdivision: 'ready_reserve' });
const por  = await mk({ callsign: 'Porkins',  name: 'Logan Kim',    modex: '420', rank: '1stLt',billet: 'Pilot',    subdivision: 'ready_reserve' });
// FRS
const herk = await mk({ callsign: 'Herk',     name: 'River Stone',  modex: '453', rank: '2ndLt',billet: 'Student',  subdivision: 'frs' });
const welc = await mk({ callsign: 'Welcome',  name: 'Sasha Park',   modex: '451', rank: '2ndLt',billet: 'Student',  subdivision: 'frs' });
// Candidate
const cb   = await mk({ callsign: 'CamBam',   name: 'Devon Yu',     modex: '462', rank: 'MIDN', billet: 'Candidate',subdivision: 'candidate' });
const vike = await mk({ callsign: 'Vike',     name: 'Andie Vale',   modex: '464', rank: 'MIDN', billet: 'Candidate',subdivision: 'candidate' });

const allActiveMembers = [fett, mav, goose, ice, viper, arc, red, pen, fev, bd, op, mar, stu, bad, gat, dmp, jaba, por, herk, welc, cb, vike, holly];

// IQT to everyone who needs it (auto-assigned anyway via is_basic, but set
// awarded status explicitly for the main roster).
for (const m of [arc, red, pen, fev, bd, op, mar, stu, dmp, bad, gat, jaba, por]) await setQ(m, iqt);
for (const m of [arc, red, pen, fev, bd, op, mar, stu, dmp]) await setQ(m, cq);
for (const m of [arc, red, pen, fev, bd, op, mar, stu]) await setQ(m, mcq);
for (const m of [arc, fev, mar]) await setQ(m, cmq);
for (const m of [red, pen, bd]) await setQ(m, sead);

// Sign off most IQT activities for the main squadron pilots — populates the
// Training Board cells meaningfully.
for (const m of [fett, mav, ice, arc, fev, mar, stu]) {
  for (const a of allIqtActs) await sign(m, a);
}
for (const m of [red, pen, bd, op, dmp, jaba]) {
  for (const a of allIqtActs.slice(0, 7)) await sign(m, a);   // 7/10 -> training
}
for (const a of allIqtActs.slice(0, 3)) await sign(bad, a);  // 3/10 -> training
for (const a of allIqtActs.slice(0, 2)) await sign(welc, a); // 2/10 -> training

// --- Modex pools per subdivision ---
const setPool = (sub, start, end, notes) =>
  call(`/api/wings/1/modex-pools/${sub}`, { method: 'PUT', body: { range_start: start, range_end: end, notes } });
await setPool('main',          400, 419, 'Active duty fleet roster');
await setPool('ready_reserve', 420, 439, 'Ready reserve / on-call');
await setPool('frs',           450, 459, 'Fleet Replacement Squadron students');
await setPool('candidate',     460, 467, 'Pre-IQT candidates / midshipmen');

// --- Wing OpsBot Discord publish config (so the panel shows wired/paused state) ---
await call('/api/wings/1/ops-bot', { method: 'PUT', body: {
  ops_bot_url: 'https://dcsoptbot-production-0c4b.up.railway.app',
  ops_bot_token: 'demo-token-not-real',
}});

// --- Carriers + traps (Epic 6 + Phase 1 Boarding Rate KPI tile) ---
const carr = (await call('/api/wings/1/carriers', { method: 'POST', body: {
  name: 'USS Theodore Roosevelt', hull: 'CVN-71', class: 'Nimitz', brc: 30,
  notes: 'Big stick. Primary recovery deck for CVW-1.',
}})).id;
const trap = (mid, grade, wire, days, aoa = 'OK', lineup = 'OK', gs = 'OK', com = '') =>
  call(`/api/carriers/${carr}/traps`, { method: 'POST', body: {
    member_id: mid, airframe: 'F-14B', grade, wire,
    aoa, lineup, glideslope: gs, ball_call: '', comments: com,
    time_at: NOW - days * DAY,
  }});
// Fett — strong CQ pilot
await trap(fett, '_OK_', 4, 80, 'OK', 'OK', 'OK', 'Perfect pass');
await trap(fett, 'OK',   3, 70);
await trap(fett, 'OK',   3, 60);
await trap(fett, '(OK)', 2, 50, 'LO');
await trap(fett, 'OK',   3, 40);
await trap(fett, 'OK',   3, 30);
await trap(fett, 'OK',   3, 20);
await trap(fett, '_OK_', 4, 10);
// Maverick — solid but a couple bolters
await trap(mav, 'OK',   3, 75);
await trap(mav, 'B',    0, 65, 'OK', 'OK', 'OK', 'Pwr off in close');
await trap(mav, '(OK)', 2, 55);
await trap(mav, 'OK',   3, 45);
await trap(mav, 'OK',   3, 35);
await trap(mav, 'WO',   0, 25, 'HI', 'OK', 'OK', 'Wave off settle');
await trap(mav, 'OK',   3, 15);
// Arcolepsy — newer to CQ
await trap(arc, '(OK)', 2, 60);
await trap(arc, 'OK',   3, 50);
await trap(arc, 'B',    0, 40, 'OK', 'OK', 'OK', 'Bolter');
await trap(arc, 'OK',   3, 30);
await trap(arc, '(OK)', 2, 20);
// Iceman
await trap(ice, 'OK',   3, 60);
await trap(ice, 'OK',   3, 50);
await trap(ice, '_OK_', 4, 40);
await trap(ice, '(OK)', 2, 25);
// Fever
await trap(fev, 'OK',   3, 55);
await trap(fev, 'OK',   3, 40);
// Stuka
await trap(stu, '(OK)', 2, 50);
await trap(stu, 'B',    0, 30, 'OK', 'OK', 'OK', 'Boltered, came back, trapped');
await trap(stu, 'OK',   3, 20);

// --- Training sessions (Phase 3.2 IP Training Dashboard) ---
const session = (pilot, instructor, days, mins, topics, qid = null) =>
  call('/api/wings/1/training-sessions', { method: 'POST', body: {
    pilot_member_id: pilot, instructor_member_id: instructor,
    qual_id: qid, started_at: NOW - days * DAY, duration_minutes: mins,
    topics, notes: '',
  }});
await session(welc, fev,  18, 90, 'IQT Cold Start, ground handling',      iqt);
await session(welc, fev,  10, 90, 'IQT pattern work + landings',            iqt);
await session(welc, fev,   3, 60, 'IQT formation review',                   iqt);
await session(cb,   fev,  20, 75, 'IQT intro to procedures',                iqt);
await session(cb,   fev,   5, 90, 'IQT navigation + checklist discipline',  iqt);
await session(vike, fev,   8, 60, 'IQT pattern entry',                      iqt);
await session(herk, fett, 12, 75, 'MCQ wingman duties + AAR',               mcq);
await session(por,  fett, 14, 60, 'CQ Case I procedures',                   cq);
await session(jaba, mar,   6, 75, 'CQ LSO debrief + corrections',           cq);

// --- Wing-wide Discord publish — discord_paused defaults to 0; leave it alone ---

// --- Cross-Squadron enrollment example ---
// VFC-12 Aggressors (squadron 3)
await call('/api/squadrons', { method: 'POST', body: {
  wing_id: 1, name: 'Aggressors', tag: 'VFC-12', aircraft: 'F-5E',
  description: 'Aggressor squadron — dissimilar air combat training partner for the wing.',
}});
const agg1 = await mk({ callsign: 'Spike', name: 'Quinn Vetter', modex: '430', rank: 'LCdr', billet: 'AO', subdivision: 'main' });
// Re-target the new aggressor to squadron 3
await call(`/api/members/${agg1}`, { method: 'PUT', body: { squadron_id: 3, callsign: 'Spike', name: 'Quinn Vetter', modex: '430', rank: 'LCdr', billet: 'AO', status: 'active' } });
// Enroll Spike in VF-1's pipeline (he trains under their CQ to fly off CVN-71)
await call('/api/squadrons/1/enroll', { method: 'POST', body: { member_id: agg1, notes: 'CQ refresher for cross-deck operations.' } });

// --- Documents (Phase 3.4 Docs CMS) ---
const doc = (scope, scopeId, title, content) =>
  call('/api/wings/1/documents', { method: 'POST', body: { scope, scope_id: scopeId, title, content } });
await doc('wing', null, 'Wing SOP — Communications', `# Wing-wide Communications SOP\n\nAll inbound CAS check-ins on Strike. Wingman comms on tactical. Visual range = call "tally." Beyond visual = call "judy" with bearing/range.\n\n## Frequencies\n- Strike: 256.0\n- Tactical: 240.0\n- Tanker: 244.0\n- Marshall: 254.0\n\n## Brevity\nStandard NATO brevity. No squawk-and-talk on tactical.`);
await doc('wing', null, 'Wing SOP — Emergency Procedures', `# Emergency Procedures\n\n## Bingo\nDeclare bingo immediately. State fuel + intentions.\n\n## Hung Ordnance\nClear vector to safe jettison area. RTB only after confirmed safe.\n\n## Lost Comms\nSquawk 7600. Continue to last assigned waypoint. Visual rejoin.`);
await doc('squadron', 1, 'VF-1 Wolfpack — Section Lead Standards', `# Section Lead Expectations\n\n## Pre-mission\n- Brief contract with wing\n- Verify fuel ladder + bingo number\n- Confirm tanker availability\n\n## In-flight\n- Maintain contract\n- Update wing every fuel state\n- Call merge / commit per ROE`);
await doc('qual', iqt, 'IQT Study Guide', `# IQT Curriculum\n\n## Phase 1: Procedures (weeks 1-2)\nCold start, ground handling, taxi, takeoff, basic instruments.\n\n## Phase 2: Formation (weeks 3-4)\nRunning rendezvous, CV rendezvous, parade, cruise.\n\n## Phase 3: Navigation (weeks 5-6)\nTACAN, waypoint nav, low alt visual nav.\n\n## Phase 4: Check Ride (week 7)\nFull profile flight evaluating all prior phases.`);
await doc('qual', cq, 'CQ Study Guide', `# Carrier Qualification\n\n## Case I (VFR day)\nMarshall stack at the IP. 250kts. Break at 800ft AGL. Downwind, abeam, into the groove, ball call: callsign + type + ball + fuel.\n\n## Case II (Marginal VFR)\nApproach mostly Case I but with cloud break management.\n\n## Case III (Night/IMC)\nFull ILS approach off marshall. Ball call same format.`);
await doc('qual', sead, 'Advanced SEAD — Threat Library', `# Threat IADS Reference\n\n## SA-2 family\nLegacy command-guidance. Long radar warning, predictable lethal envelope. Defeat via terrain masking + speed.\n\n## SA-11 / SA-17\nSemi-active. Fragmenting warhead. 30-40km lethal envelope. HARM-shoot before merge.\n\n## SA-10 / SA-20 family\nLong-range, high-PK. Stay outside lethal envelope or get inside engagement timeline.`);

// --- More events for the Calendar + Metrics chart ---
const mkev2 = async (title, kind, days) => (await call('/api/events', {
  method: 'POST', body: { wing_id: 1, squadron_id: 1, title, kind, start_at: NOW + days * DAY },
})).id;
const olderEvents = [];
for (let w = 1; w <= 12; w++) {
  const days = -w * 7 + (w % 2 === 0 ? -3 : 0); // Tuesdays + some Fridays
  if (w % 3 === 0) olderEvents.push(await mkev2(`SEAD Practice ${w}`, 'squadron', days));
  else if (w % 2 === 0) olderEvents.push(await mkev2(`BFM Round ${w}`, 'squadron', days));
  else olderEvents.push(await mkev2(`General Training ${w}`, 'squadron', days));
}
// Attendance on each — mostly present with a sprinkle of UA/excused for realism
const mainPilots = [fett, mav, goose, ice, viper, arc, red, pen, fev, bd, op, mar, stu];
for (const eid of olderEvents) {
  for (const mid of mainPilots) {
    const r = Math.random();
    const s = r < 0.7 ? 'present' : r < 0.82 ? 'extra_credit' : r < 0.92 ? 'excused' : r < 0.97 ? 'absent' : 'ua';
    await att(eid, mid, s);
  }
}
// More upcoming events for the calendar grid
await mkev2('Carrier Qual Refresher', 'squadron', 17);
await mkev2('Wing All-Hands',          'squadron', 21);
await mkev2('SEAD Qual Hop',           'extra_credit', 25);

console.log('\nDemo seeded. Open http://localhost:4700/auth/dev-login to sign in.');
console.log('Highlights:');
console.log('  Personnel    — 24+ pilots, 4 subdivisions, modex pools wired');
console.log('  Qualifications — 5 quals w/ rich descriptions, ~30 activities, partial sign-offs');
console.log('  Training Board — populated cells across the wing');
console.log('  Currency     — 80% qualified, a few expiring + expired for filter testing');
console.log('  Calendar     — 12+ historical events w/ attendance, 4 upcoming');
console.log('  Carriers     — 30 traps logged for the greenie board / boarding rate KPI');
console.log('  IP Training  — 9 instructor-pilot sessions logged');
console.log('  Docs         — 6 documents across wing / squadron / qual scopes');
console.log('  Cross-Sqn    — VFC-12 Aggressor enrolled in VF-1 pipeline');
