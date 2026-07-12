// Server-side wall-calendar PNG renderer. Ready Room OWNS this: the /share
// calendar.png endpoint uses it to hand the Ops Bot a finished image, and the
// same data drives the React month view (dashboard/src/pages/Calendar.jsx).
//
// Design: dark, 24-hour, compact cells, purple accent, per-event sign-up badge
// (filled/total), weekend shading. Rendered with @napi-rs/canvas (prebuilt
// binaries → no system libs on Railway). A bundled Inter font is registered so
// text renders on a headless container (fillText draws nothing without a font).

import { fileURLToPath } from 'node:url';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

let _canvas = null;
async function loadCanvas() {
  if (_canvas) return _canvas;
  const mod = await import('@napi-rs/canvas');
  try {
    const fontPath = fileURLToPath(new URL('../../assets/fonts/Inter-Variable.ttf', import.meta.url));
    if (!mod.GlobalFonts.has('Inter')) mod.GlobalFonts.registerFromPath(fontPath, 'Inter');
  } catch (e) {
    console.warn('[calendar] font register failed (text may not render):', e.message);
  }
  _canvas = mod;
  return mod;
}

export function isValidTz(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}
function tzParts(ms, tz) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const p = {};
  for (const part of fmt.formatToParts(new Date(ms))) p[part.type] = part.value;
  return { y: +p.year, m: +p.month, d: +p.day, hh: p.hour === '24' ? '00' : p.hour, mm: p.minute };
}
// Current year/month in a tz, shifted by `offset` months.
export function monthInTz(nowMs, tz, offset = 0) {
  const p = tzParts(nowMs, tz);
  let year = p.y, month = p.m - 1 + offset;
  while (month < 0) { month += 12; year--; }
  while (month > 11) { month -= 12; year++; }
  return { year, month };
}
function monthGrid(year, month) {
  const first = new Date(Date.UTC(year, month, 1));
  const firstDow = first.getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const weeks = Math.ceil((firstDow + daysInMonth) / 7);
  const start = new Date(Date.UTC(year, month, 1 - firstDow));
  const cells = [];
  for (let i = 0; i < weeks * 7; i++) {
    const dt = new Date(start);
    dt.setUTCDate(start.getUTCDate() + i);
    cells.push({ y: dt.getUTCFullYear(), m: dt.getUTCMonth(), d: dt.getUTCDate(), inMonth: dt.getUTCMonth() === month });
  }
  return { cells, weeks };
}

const C = {
  bg: '#1b1d21', header: '#ffffff', sub: '#9aa0a6', cell: '#232529', cellOut: '#1f2125',
  cellToday: '#2a2f3a', weekend: '#20262b', dayNum: '#c9cdd3', dayNumOut: '#5b6067',
  weekday: '#8b9099', accent: '#9119f5', eventText: '#e6e8eb', more: '#8b9099', seat: '#8b9099',
};
const KIND_COLORS = {
  squadron: '#4c8dff', mission: '#4c8dff', extra_credit: '#f5a623', training: '#22c55e',
  social: '#ec4899', event: '#22c55e', ops: '#4c8dff',
};
const PALETTE = ['#4c8dff', '#22c55e', '#f5a623', '#ec4899', '#14b8a6', '#a855f7', '#ef4444', '#eab308'];
function kindColor(k) {
  const key = String(k || '').toLowerCase();
  if (KIND_COLORS[key]) return KIND_COLORS[key];
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
const pad2 = (n) => String(n).padStart(2, '0');
function rr(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function ellipsize(ctx, text, maxW) {
  text = String(text);
  if (ctx.measureText(text).width <= maxW) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(text.slice(0, mid) + '…').width <= maxW) lo = mid; else hi = mid - 1;
  }
  return text.slice(0, lo).trimEnd() + '…';
}

// events: [{ title, start (ms), kind, filled, total }]
export async function renderCalendarPng({ year, month, tz, title = null, events = [], generatedAt = Date.now() }) {
  const canvasMod = await loadCanvas();
  const { cells, weeks } = monthGrid(year, month);

  const buckets = new Map();
  for (const ev of events) {
    const p = tzParts(ev.start, tz);
    const key = `${p.y}-${p.m}-${p.d}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(ev);
  }
  for (const list of buckets.values()) list.sort((a, b) => a.start - b.start);

  const PAD = 34, W = 1540, HEADER_H = 92, WEEKDAY_H = 40, CELL_H = 168;
  const colW = (W - PAD * 2) / 7;
  const H = PAD + HEADER_H + WEEKDAY_H + weeks * CELL_H + PAD;

  const canvas = canvasMod.createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = C.header;
  ctx.font = '700 44px Inter';
  ctx.fillText(`${MONTHS[month]} ${year}`, PAD, PAD + 46);
  ctx.textAlign = 'right';
  if (title) { ctx.fillStyle = C.sub; ctx.font = '600 22px Inter'; ctx.fillText(title, W - PAD, PAD + 24); }
  ctx.fillStyle = C.sub; ctx.font = '400 17px Inter';
  ctx.fillText(`Times shown in ${tz}`, W - PAD, PAD + 50);
  ctx.textAlign = 'left';
  ctx.fillStyle = C.accent;
  ctx.fillRect(PAD, PAD + HEADER_H - 16, 100, 4);

  const gridTop = PAD + HEADER_H;
  ctx.font = '600 16px Inter';
  ctx.fillStyle = C.weekday;
  ctx.textAlign = 'center';
  for (let c = 0; c < 7; c++) ctx.fillText(DOW[c], PAD + c * colW + colW / 2, gridTop + 26);
  ctx.textAlign = 'left';

  const bodyTop = gridTop + WEEKDAY_H;
  const today = tzParts(generatedAt, tz);
  const gap = 4, evH = 26, evGap = 3, maxRows = Math.floor((CELL_H - 58) / (evH + evGap));

  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    const wk = Math.floor(i / 7), dc = i % 7;
    const x = PAD + dc * colW, y = bodyTop + wk * CELL_H;
    const isToday = cell.inMonth && cell.y === today.y && (cell.m + 1) === today.m && cell.d === today.d;
    const isWeekend = dc === 0 || dc === 6;

    ctx.fillStyle = cell.inMonth ? (isToday ? C.cellToday : (isWeekend ? C.weekend : C.cell)) : C.cellOut;
    rr(ctx, x + gap / 2, y + gap / 2, colW - gap, CELL_H - gap, 8);
    ctx.fill();

    ctx.font = '700 20px Inter';
    if (isToday) {
      ctx.fillStyle = C.accent;
      ctx.beginPath(); ctx.arc(x + 24, y + 25, 15, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.fillText(String(cell.d), x + 24, y + 32);
      ctx.textAlign = 'left';
    } else {
      ctx.fillStyle = cell.inMonth ? C.dayNum : C.dayNumOut;
      ctx.fillText(String(cell.d), x + 15, y + 32);
    }

    const list = buckets.get(`${cell.y}-${cell.m + 1}-${cell.d}`) || [];
    let shown = list.length;
    if (list.length > maxRows) shown = Math.max(0, maxRows - 1);
    const evTop = y + 46;
    for (let e = 0; e < shown; e++) {
      const ev = list[e];
      const ey = evTop + e * (evH + evGap);
      const col = kindColor(ev.kind);
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      rr(ctx, x + 10, ey, colW - 20, evH, 5); ctx.fill();
      ctx.fillStyle = col;
      rr(ctx, x + 10, ey, 4, evH, 2); ctx.fill();
      const tp = tzParts(ev.start, tz);
      const time = `${tp.hh}:${tp.mm}`;
      ctx.font = '700 13px Inter';
      ctx.fillStyle = col;
      ctx.fillText(time, x + 21, ey + 17);
      const tw = ctx.measureText(time).width;
      let rightReserve = 0;
      if (ev.total) {
        const st = `${ev.filled ?? 0}/${ev.total}`;
        ctx.font = '600 12px Inter';
        rightReserve = ctx.measureText(st).width + 10;
        ctx.fillStyle = C.seat;
        ctx.textAlign = 'right';
        ctx.fillText(st, x + colW - 18, ey + 17);
        ctx.textAlign = 'left';
      }
      ctx.font = '500 14px Inter';
      ctx.fillStyle = C.eventText;
      ctx.fillText(ellipsize(ctx, ev.title, colW - 21 - tw - 16 - rightReserve), x + 21 + tw + 8, ey + 17);
    }
    if (list.length > shown) {
      ctx.font = '600 13px Inter';
      ctx.fillStyle = C.more;
      ctx.fillText(`+${list.length - shown} more`, x + 16, evTop + shown * (evH + evGap) + 15);
    }
  }

  ctx.font = '400 14px Inter';
  ctx.fillStyle = C.sub;
  ctx.textAlign = 'right';
  ctx.fillText(`Updated ${today.y}-${pad2(today.m)}-${pad2(today.d)} ${today.hh}:${today.mm}`, W - PAD, H - 13);
  ctx.textAlign = 'left';

  return canvas.toBuffer('image/png');
}

export { MONTHS };
