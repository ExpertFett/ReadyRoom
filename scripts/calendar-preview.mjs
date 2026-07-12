// Render a wall-calendar PNG WITHOUT a browser or deploy — the clean way to see
// design changes. Uses Ready Room's own renderer with built-in sample events.
//
//   node scripts/calendar-preview.mjs
//   node scripts/calendar-preview.mjs --tz Europe/London --title "104th VFW" --month next
//   node scripts/calendar-preview.mjs --out C:\path\to\preview.png
//
// Writes ./calendar-preview.png by default and prints the path.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderCalendarPng, monthInTz } from '../src/render/calendar.js';

const argv = process.argv.slice(2);
const arg = (name, dflt) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt; };
const tz = arg('tz', 'America/Denver');
const title = arg('title', 'Ready Room — Sample');
const out = arg('out', join(process.cwd(), 'calendar-preview.png'));
const monthArg = arg('month', 'this');
const offset = monthArg === 'next' ? 1 : monthArg === 'prev' ? -1 : (Number(monthArg) || 0);

const { year, month } = monthInTz(Date.now(), tz, offset);

// epoch ms whose wall-clock in `tz` equals the given local date/time
function zoned(y, mo, d, H, M) {
  const asUTC = Date.UTC(y, mo, d, H, M);
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const p = Object.fromEntries(f.formatToParts(new Date(asUTC)).map((x) => [x.type, x.value]));
  const asTz = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute);
  return asUTC - (asTz - asUTC);
}
const e = (d, H, M, t, k, f = null, tot = null) => ({ title: t, start: zoned(year, month, d, H, M), kind: k, filled: f, total: tot });
const events = [
  e(3, 19, 30, 'Friday Night Ops: Persian Gulf CAP', 'squadron', 12, 16),
  e(6, 20, 0, 'SEAD Training Block A', 'training', 6, 8),
  e(6, 21, 30, 'BFM 1v1 Ladder', 'training', 4, 8),
  e(9, 18, 0, 'Wing Brief', 'ops'),
  e(11, 19, 0, 'Red Flag 26-3 — Strike Package Alpha vs IADS', 'squadron', 18, 24),
  e(11, 20, 0, 'Tanker Quals', 'training', 3, 6),
  e(11, 21, 0, 'Movie Night', 'social'),
  e(11, 21, 30, 'Late Night Dogfights', 'social', 8, 12),
  e(14, 19, 30, 'Carrier Quals — CASE III Recovery', 'squadron', 9, 12),
  e(18, 20, 0, 'Combat SAR Scenario', 'mission', 5, 8),
  e(20, 18, 0, 'Ground School: Radar Fundamentals', 'training', 11, 20),
  e(24, 19, 0, 'Dynamic Campaign Night', 'squadron', 14, 16),
  e(25, 20, 0, 'Helo Ops CSAR', 'mission', 4, 4),
  e(27, 21, 0, 'Community Fun Fly', 'social'),
];

const png = await renderCalendarPng({ year, month, tz, title, events });
writeFileSync(out, png);
console.log(`Wrote ${out} (${png.length} bytes) — ${year}-${String(month + 1).padStart(2, '0')}`);
