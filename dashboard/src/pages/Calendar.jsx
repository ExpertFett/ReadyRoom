import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useMe } from '../App.jsx';

const WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const isoDay = (d) => d.toISOString().slice(0, 10);

// Compact local time for calendar chips, e.g. "7:30p" or "9a". Always shows
// so you can see WHEN an event is right on the month grid, not just its title.
const evtTime = (ms) => {
  if (!ms) return '';
  const d = new Date(ms);
  let h = d.getHours();
  const m = d.getMinutes();
  const ap = h < 12 ? 'a' : 'p';
  h = h % 12 || 12;
  return m ? `${h}:${String(m).padStart(2, '0')}${ap}` : `${h}${ap}`;
};

const evtDateShort = (ms) => new Date(ms).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
// One-line summary of an event's flights/taskings (or its kind if no flights).
function eventSummary(e) {
  if (e.roles?.length) {
    const groups = [];
    const seen = new Set();
    for (const r of e.roles) { const g = r.group || 'Slots'; if (!seen.has(g)) { seen.add(g); groups.push(g); } }
    return groups.map((g) => { const t = e.taskings?.[g]; return t ? `${g} (${t})` : g; }).join(' · ');
  }
  return e.kind === 'extra_credit' ? 'Extra credit' : e.track_attendance ? 'Attendance tracked' : 'Squadron event';
}

export default function Calendar() {
  const { me, activeWing } = useMe();
  const [view, setView] = useState('list'); // 'list' (upfront agenda) | 'month'
  const [cursor, setCursor] = useState(() => {
    const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d;
  });
  const [events, setEvents] = useState([]);
  const [upcoming, setUpcoming] = useState([]);
  const [creating, setCreating] = useState(false);
  const [squads, setSquads] = useState([]);
  const [loas, setLoas] = useState([]);

  // Squadron calendar colors — tint each event chip by its host squadron.
  useEffect(() => {
    if (activeWing) api.get(`/api/squadrons?wing_id=${activeWing.id}`).then(setSquads).catch(() => {});
  }, [activeWing]);
  // Approved LOAs — overlay who's on leave on the month grid. Keyed on cursor
  // (with since = the visible grid's start) so past months show their LOAs too.
  useEffect(() => {
    if (!activeWing) return;
    const start = new Date(cursor); start.setDate(1 - cursor.getDay());
    api.get(`/api/wings/${activeWing.id}/loas?since=${start.getTime()}`)
      .then((l) => setLoas((l || []).filter((x) => x.status === 'approved'))).catch(() => {});
  }, [activeWing, cursor]);

  // Month grid: the visible 6-week window.
  useEffect(() => {
    if (!activeWing) return;
    const start = new Date(cursor); start.setDate(1 - cursor.getDay());
    const end = new Date(start); end.setDate(start.getDate() + 42);
    api.get(`/api/wings/${activeWing.id}/events?from=${start.getTime()}&to=${end.getTime()}`).then(setEvents);
  }, [cursor, activeWing, creating]);

  // Agenda list: everything from now out ~90 days, soonest first.
  useEffect(() => {
    if (!activeWing) return;
    const now = Date.now();
    api.get(`/api/wings/${activeWing.id}/events?from=${now}&to=${now + 90 * 86400000}`)
      .then((list) => setUpcoming((list || []).filter((e) => e.start_at >= now - 3600000)));
  }, [activeWing, creating]);

  if (!activeWing) return <div className="empty">No wing yet. <Link to="/wing">Set one up →</Link></div>;

  const monthStart = new Date(cursor);
  const gridStart = new Date(monthStart); gridStart.setDate(1 - monthStart.getDay());
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart); d.setDate(gridStart.getDate() + i); return d;
  });
  const byDay = new Map();
  for (const e of events) {
    const key = isoDay(new Date(e.start_at));
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(e);
  }
  const today = isoDay(new Date());
  const sqColor = {};
  for (const s of squads) if (s.calendar_color) sqColor[s.id] = s.calendar_color;
  // Bucket approved LOAs by iso day ONCE per render (not a filter per cell).
  // Starting from the leave's own start DAY also fixes the old `start_at <= de`
  // boundary bug (a leave starting exactly at next-midnight showed a day early).
  const loasByDay = new Map();
  for (const l of loas) {
    const d = new Date(l.start_at); d.setHours(0, 0, 0, 0);
    for (let i = 0; d.getTime() <= l.end_at && i < 400; i++) {   // cap ~13 months
      const k = isoDay(d);
      if (!loasByDay.has(k)) loasByDay.set(k, []);
      loasByDay.get(k).push(l);
      d.setDate(d.getDate() + 1);                                 // DST-safe step
    }
  }

  const fmtMonth = cursor.toLocaleString([], { month: 'long', year: 'numeric' });
  const move = (delta) => () => {
    const d = new Date(cursor); d.setMonth(d.getMonth() + delta); setCursor(d);
  };
  const jumpToday = () => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); setCursor(d); };

  return (
    <div>
      <div className="between">
        <h1>Events</h1>
        <div className="row" style={{ gap: 8 }}>
          <button className={`small ${view === 'list' ? 'primary' : ''}`} onClick={() => setView('list')}>List</button>
          <button className={`small ${view === 'month' ? 'primary' : ''}`} onClick={() => setView('month')}>Month</button>
          {me.isAdmin && <button className="primary" onClick={() => setCreating((v) => !v)}>{creating ? 'Cancel' : '+ Create event'}</button>}
        </div>
      </div>

      {creating && <CreateEvent wing={activeWing} onDone={() => setCreating(false)} />}

      {view === 'list' ? (
        <AgendaList events={upcoming} />
      ) : (
        <>
          <div className="row" style={{ alignItems: 'center', marginTop: 12, gap: 8 }}>
            <button className="small" onClick={move(-1)}>‹</button>
            <button className="small" onClick={jumpToday}>Today</button>
            <button className="small" onClick={move(1)}>›</button>
            <strong style={{ marginLeft: 6 }}>{fmtMonth}</strong>
          </div>

          <div className="cal-grid">
            {WEEK.map((d) => <div key={d} className="cal-head">{d}</div>)}
            {cells.map((d, i) => {
              const key = isoDay(d);
              const inMonth = d.getMonth() === monthStart.getMonth();
              const list = byDay.get(key) || [];
              const dl = loasByDay.get(key) || [];
              return (
                <div key={i} className={`cal-cell ${inMonth ? '' : 'out'} ${key === today ? 'today' : ''}`}>
                  <div className="cal-date">{d.getDate()}</div>
                  {list.map((e) => (
                    <Link key={e.id} to={`/events/${e.id}`} className={`cal-evt ${e.kind}`} title={`${evtTime(e.start_at)} · ${e.title}`}
                      style={sqColor[e.squadron_id] ? { borderLeft: `3px solid ${sqColor[e.squadron_id]}`, paddingLeft: 4 } : undefined}>
                      {e.kind === 'extra_credit' ? '★ ' : ''}
                      {e.discord_message_id
                        ? <span title="Posted to Discord" style={{ marginRight: 2 }}>📌</span>
                        : (e.discord_post_at && e.discord_post_at > Date.now() && <span title="Scheduled to post to Discord" style={{ marginRight: 2 }}>⏳</span>)}
                      <span className="cal-evt-time">{evtTime(e.start_at)}</span> {e.title}
                    </Link>
                  ))}
                  {dl.length > 0 && (
                    <div className="small muted" style={{ marginTop: 2 }}
                      title={`On leave: ${dl.map((x) => x.callsign || x.modex || '?').join(', ')}`}>🌴 {dl.length} on leave</div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="row small muted" style={{ marginTop: 12, gap: 18, flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span className="cal-evt squadron" style={{ display: 'inline-block', width: 14, height: 10, padding: 0, margin: 0 }} /> Squadron event
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span className="cal-evt extra_credit" style={{ display: 'inline-block', width: 14, height: 10, padding: 0, margin: 0 }} /> ★ Extra credit
            </span>
            <span>📌 Posted to Discord</span>
            <span>⏳ Scheduled to post</span>
            <span>🌴 On leave (LOA)</span>
            <span className="muted">Left bar = squadron color</span>
          </div>
        </>
      )}
    </div>
  );
}

// Upfront agenda: upcoming events as scannable rows so members don't have to
// dig through the month grid. Date/time on the left, title + flight summary in
// the middle, seats filled on the right; the whole row links to the event.
function AgendaList({ events }) {
  if (!events.length) return <div className="empty" style={{ marginTop: 14 }}>No upcoming events.</div>;
  return (
    <div className="card" style={{ padding: 0, marginTop: 14 }}>
      {events.map((e) => (
        <Link key={e.id} to={`/events/${e.id}`} className="list-row" style={{ padding: '11px 14px' }}>
          <div style={{ display: 'flex', gap: 14, minWidth: 0 }}>
            <div style={{ minWidth: 92, flex: '0 0 auto' }}>
              <div className="callsign">{evtDateShort(e.start_at)}</div>
              <div className="small muted">{evtTime(e.start_at)}</div>
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="callsign">
                {e.kind === 'extra_credit' && '★ '}{e.title}
                {e.discord_message_id && <span className="muted small" title="Posted to Discord"> · 📌</span>}
              </div>
              <div className="small muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{eventSummary(e)}</div>
            </div>
          </div>
          {e.seats_total > 0 && <span className="seat-pill" title="Seats filled">{e.seats_filled}/{e.seats_total}</span>}
        </Link>
      ))}
    </div>
  );
}

function CreateEvent({ wing, onDone }) {
  const navigate = useNavigate();
  const [squadrons, setSquadrons] = useState([]);
  const [f, setF] = useState({ title: '', kind: 'squadron', start_at: '', squadron_id: '', description: '', track_attendance: true });
  const [flights, setFlights] = useState([]); // [{ name, tasking, seats, qual }]
  const [postMode, setPostMode] = useState('now'); // now | schedule | none
  const [postAt, setPostAt] = useState('');
  const [repeat, setRepeat] = useState(false);
  const [repeatWeeks, setRepeatWeeks] = useState(4);
  const [repeatDays, setRepeatDays] = useState([]);
  useEffect(() => { api.get(`/api/squadrons?wing_id=${wing.id}`).then(setSquadrons); }, [wing.id]);

  // Default the weekday set to the start date's weekday once a date is picked.
  const anchorDow = f.start_at ? new Date(f.start_at).getDay() : null;
  const days = repeatDays.length ? repeatDays : (anchorDow != null ? [anchorDow] : []);
  const occ = repeat ? weeklyOccurrences(f.start_at, days, Number(repeatWeeks) || 0) : [];

  const submit = async (e) => {
    e.preventDefault();
    if (!f.title.trim() || !f.start_at) return;
    const base = {
      wing_id: wing.id, ...f,
      // Convert the datetime-local string to epoch ms HERE, in the user's
      // timezone. If we sent the raw "2026-06-10T19:30" string, the server
      // (UTC on Railway) would parse it as UTC and shift the event by the
      // user's offset (e.g. 7:30pm MDT shown back as 1:30pm).
      start_at: new Date(f.start_at).getTime(),
      squadron_id: f.squadron_id ? Number(f.squadron_id) : null,
      ...flightsToRoles(flights),
    };
    // Recurring series: send the occurrence timestamps (series events don't
    // auto-post to Discord). Single event keeps the discord_post_at behavior.
    if (repeat && occ.length > 1) {
      await api.post('/api/events', { ...base, occurrences: occ });
      onDone();
      navigate('/events');
      return;
    }
    const ev = await api.post('/api/events', { ...base, discord_post_at: computePostAt(postMode, postAt) });
    onDone();
    navigate(`/events/${ev.id}`);
  };
  return (
    <form className="card" onSubmit={submit} style={{ marginTop: 14 }}>
      <h3 style={{ marginTop: 0 }}>Create event</h3>
      <div className="form-grid">
        <div className="field"><label>Title *</label><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="SEAD Training" /></div>
        <div className="field"><label>Date &amp; time *</label>
          <input type="datetime-local" value={f.start_at} onChange={(e) => setF({ ...f, start_at: e.target.value })} />
          {f.start_at && (
            <span className="small" style={{ color: 'var(--accent-2, #4cd964)', marginTop: 4, display: 'block' }}>
              {new Date(f.start_at).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
              <span className="muted"> · local time</span>
            </span>
          )}
        </div>
        <div className="field"><label>Kind</label>
          <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
            <option value="squadron">Squadron event</option>
            <option value="extra_credit">Extra credit</option>
          </select></div>
        <div className="field"><label>Host squadron</label>
          <select value={f.squadron_id} onChange={(e) => setF({ ...f, squadron_id: e.target.value })}>
            <option value="">(wing-wide)</option>
            {squadrons.map((s) => <option key={s.id} value={s.id}>{s.tag || s.name}</option>)}
          </select></div>
      </div>
      <div className="field"><label>Description</label><textarea rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Objectives, notes…" /></div>

      <FlightsEditor flights={flights} setFlights={setFlights} />

      <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input type="checkbox" style={{ width: 'auto' }} checked={f.track_attendance} onChange={(e) => setF({ ...f, track_attendance: e.target.checked })} />
        Track attendance
      </label>

      <div className="field">
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={repeat} onChange={(e) => setRepeat(e.target.checked)} />
          Repeat weekly
        </label>
        {repeat && (
          <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
            <span className="small">On</span>
            <div className="row" style={{ gap: 3 }}>
              {DOW_LABELS.map((lbl, i) => {
                const on = days.includes(i);
                return (
                  <button type="button" key={i} className={`small ${on ? 'primary' : ''}`} style={{ width: 30, padding: '4px 0' }}
                    onClick={() => setRepeatDays((prev) => {
                      const cur = prev.length ? prev : (anchorDow != null ? [anchorDow] : []);
                      return cur.includes(i) ? cur.filter((d) => d !== i) : [...cur, i];
                    })}>{lbl}</button>
                );
              })}
            </div>
            <span className="small">for</span>
            <input type="number" min="1" max="52" value={repeatWeeks} onChange={(e) => setRepeatWeeks(e.target.value)} style={{ width: 60 }} />
            <span className="small">weeks</span>
            <span className="small muted">→ {occ.length} event{occ.length === 1 ? '' : 's'}</span>
          </div>
        )}
      </div>

      {!(repeat && occ.length > 1) && <DiscordPostFields mode={postMode} setMode={setPostMode} at={postAt} setAt={setPostAt} />}
      {repeat && occ.length > 1 && <p className="muted small">Series events are created but not auto-posted to Discord — post each from its event page.</p>}
      <button className="primary" style={{ marginTop: 10 }}>{repeat && occ.length > 1 ? `Create ${occ.length} events →` : 'Create event →'}</button>
    </form>
  );
}

// "Post to Discord" picker: Now / At a scheduled time / Don't post. Converts to
// discord_post_at ms on the CLIENT (user's timezone) — the server stores the
// number. computePostAt() turns the picker state into that value.
export function computePostAt(mode, atLocal) {
  if (mode === 'now') return Date.now();
  if (mode === 'schedule') return atLocal ? new Date(atLocal).getTime() : null;
  return null; // 'none'
}
export function DiscordPostFields({ mode, setMode, at, setAt }) {
  return (
    <div className="field">
      <label>Post to Discord</label>
      <div className="row" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={mode} onChange={(e) => setMode(e.target.value)} style={{ width: 'auto' }}>
          <option value="now">Now (when I save)</option>
          <option value="schedule">At a scheduled time…</option>
          <option value="none">Don't post to Discord</option>
        </select>
        {mode === 'schedule' && (
          <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
        )}
      </div>
      {mode === 'schedule' && at && (
        <span className="small muted">Auto-posts {new Date(at).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · your local time</span>
      )}
      {mode === 'none' && <span className="small muted">You can post it later from the event page (Repost to Discord).</span>}
    </div>
  );
}

// Weekly recurrence: given the anchor datetime-local string, a set of weekdays
// (0=Sun..6=Sat) and a week count, return occurrence timestamps in the user's
// local TZ (same clock time each day). Occurrences before the anchor are
// dropped, so "starts Tue, repeat Tue+Thu, 4 weeks" begins on the chosen Tue.
export function weeklyOccurrences(startLocal, weekdays, weeks) {
  if (!startLocal || !weekdays.length || weeks < 1) return [];
  const base = new Date(startLocal);
  const hh = base.getHours(); const mm = base.getMinutes();
  const week0Sun = new Date(base); week0Sun.setDate(base.getDate() - base.getDay()); week0Sun.setHours(0, 0, 0, 0);
  const out = [];
  for (let w = 0; w < weeks; w++) {
    for (const wd of weekdays) {
      const d = new Date(week0Sun); d.setDate(week0Sun.getDate() + w * 7 + wd); d.setHours(hh, mm, 0, 0);
      if (d.getTime() >= base.getTime()) out.push(d.getTime());
    }
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

const DOW_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

// Standard fighter-flight position for the Nth seat (1-based): seat 1 is the
// Flight Lead, seat 3 is the Section/Element Lead, the rest are wingmen.
export function slotPosition(i) {
  if (i === 1) return 'Flight Lead';
  if (i === 3) return 'Section Lead';
  return `Dash ${i}`;
}

// Convert the editor's flight rows into the API's roles[] + taskings{} shape.
// Each flight expands to `seats` positional slots ("Spear Flight Lead",
// "Spear Dash 2", "Spear Section Lead", …) — uniquely labelled so sign-up keys
// never collide. The flight's qual gates only the LEAD seats (Flight Lead /
// Section Lead); wingman seats are open.
export function flightsToRoles(flights) {
  const roles = [];
  const taskings = {};
  for (const fl of flights) {
    const name = (fl.name || '').trim();
    if (!name) continue;
    if ((fl.tasking || '').trim()) taskings[name] = fl.tasking.trim();
    const seats = Math.max(1, Math.min(20, Number(fl.seats) || 1));
    const leadQual = (fl.qual || '').trim() || null;
    for (let i = 1; i <= seats; i++) {
      const pos = slotPosition(i);
      const isLead = i === 1 || i === 3;
      roles.push({ label: `${name} ${pos}`, group: name, limit: 1, qual: isLead ? leadQual : null });
    }
  }
  return { roles, taskings };
}

// Reverse of flightsToRoles: collapse stored roles[] + taskings{} back into the
// editor's per-flight rows (so an event can be edited). Seats = slots in the
// group; the flight-level qual is taken from the group's slots.
export function rolesToFlights(roles = [], taskings = {}) {
  const order = [];
  const byGroup = new Map();
  for (const r of roles) {
    const g = r.group || '';
    if (!byGroup.has(g)) { byGroup.set(g, { name: g, tasking: taskings[g] || '', seats: 0, qual: r.qual || '' }); order.push(g); }
    const fl = byGroup.get(g);
    fl.seats += 1;
    if (r.qual && !fl.qual) fl.qual = r.qual;
  }
  return order.map((g) => byGroup.get(g));
}

// Optional flight/slot editor. Define flights (e.g. "Spear", SEAD, 4 seats) and
// the event publishes to Discord as a full sign-up panel with one button per
// seat. Leave empty for a plain event with no sign-up slots.
export function FlightsEditor({ flights, setFlights }) {
  const add = () => setFlights([...flights, { name: '', tasking: '', seats: 2, qual: '' }]);
  const set = (i, k, v) => setFlights(flights.map((fl, j) => (j === i ? { ...fl, [k]: v } : fl)));
  const remove = (i) => setFlights(flights.filter((_, j) => j !== i));
  const totalSeats = flights.reduce((n, fl) => n + (fl.name.trim() ? Math.max(1, Number(fl.seats) || 1) : 0), 0);
  return (
    <div className="field">
      <label>Flights &amp; sign-up slots <span className="muted small">(optional — adds Discord sign-up buttons)</span></label>
      {flights.length === 0 && <p className="muted small" style={{ margin: '2px 0 6px' }}>No flights. Add one to give the event sign-up slots (pilots claim seats here and in Discord).</p>}
      {flights.map((fl, i) => (
        <div key={i} className="row" style={{ gap: 6, marginBottom: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <input style={{ flex: '1 1 110px' }} value={fl.name} onChange={(e) => set(i, 'name', e.target.value)} placeholder="Flight (Spear)" />
          <input style={{ flex: '1 1 100px' }} value={fl.tasking} onChange={(e) => set(i, 'tasking', e.target.value)} placeholder="Tasking (SEAD)" />
          <input style={{ width: 70 }} type="number" min="1" max="20" value={fl.seats} onChange={(e) => set(i, 'seats', e.target.value)} title="Seats" />
          <input style={{ flex: '1 1 110px' }} value={fl.qual} onChange={(e) => set(i, 'qual', e.target.value)} placeholder="Lead qual (opt)" title="Required to take the Flight Lead / Section Lead seats" />
          <button type="button" className="small danger" onClick={() => remove(i)}>×</button>
        </div>
      ))}
      <button type="button" className="small" onClick={add}>+ Add flight</button>
      {totalSeats > 0 && <span className="muted small" style={{ marginLeft: 10 }}>{totalSeats} seat{totalSeats === 1 ? '' : 's'} across {flights.filter((fl) => fl.name.trim()).length} flight(s)</span>}
    </div>
  );
}
