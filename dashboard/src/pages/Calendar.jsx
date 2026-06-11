import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useMe } from '../App.jsx';

const WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const isoDay = (d) => d.toISOString().slice(0, 10);

export default function Calendar() {
  const { me, activeWing } = useMe();
  const [cursor, setCursor] = useState(() => {
    const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d;
  });
  const [events, setEvents] = useState([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!activeWing) return;
    const start = new Date(cursor); start.setDate(1 - cursor.getDay());
    const end = new Date(start); end.setDate(start.getDate() + 42);
    api.get(`/api/wings/${activeWing.id}/events?from=${start.getTime()}&to=${end.getTime()}`).then(setEvents);
  }, [cursor, activeWing, creating]);

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

  const fmtMonth = cursor.toLocaleString([], { month: 'long', year: 'numeric' });
  const move = (delta) => () => {
    const d = new Date(cursor); d.setMonth(d.getMonth() + delta); setCursor(d);
  };
  const jumpToday = () => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); setCursor(d); };

  return (
    <div>
      <div className="between">
        <h1>Events</h1>
        {me.isAdmin && <button className="primary" onClick={() => setCreating((v) => !v)}>{creating ? 'Cancel' : '+ Create event'}</button>}
      </div>

      {creating && <CreateEvent wing={activeWing} onDone={() => setCreating(false)} />}

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
          return (
            <div key={i} className={`cal-cell ${inMonth ? '' : 'out'} ${key === today ? 'today' : ''}`}>
              <div className="cal-date">{d.getDate()}</div>
              {list.map((e) => (
                <Link key={e.id} to={`/events/${e.id}`} className={`cal-evt ${e.kind}`} title={e.title}>
                  {e.kind === 'extra_credit' ? '★ ' : ''}
                  {e.discord_message_id && <span title="Posted to Discord" style={{ marginRight: 2 }}>📌</span>}
                  {e.title}
                </Link>
              ))}
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
      </div>
    </div>
  );
}

function CreateEvent({ wing, onDone }) {
  const navigate = useNavigate();
  const [squadrons, setSquadrons] = useState([]);
  const [f, setF] = useState({ title: '', kind: 'squadron', start_at: '', squadron_id: '', description: '', track_attendance: true });
  useEffect(() => { api.get(`/api/squadrons?wing_id=${wing.id}`).then(setSquadrons); }, [wing.id]);
  const submit = async (e) => {
    e.preventDefault();
    if (!f.title.trim() || !f.start_at) return;
    const ev = await api.post('/api/events', {
      wing_id: wing.id, ...f,
      // Convert the datetime-local string to epoch ms HERE, in the user's
      // timezone. If we sent the raw "2026-06-10T19:30" string, the server
      // (UTC on Railway) would parse it as UTC and shift the event by the
      // user's offset (e.g. 7:30pm MDT shown back as 1:30pm).
      start_at: f.start_at ? new Date(f.start_at).getTime() : null,
      squadron_id: f.squadron_id ? Number(f.squadron_id) : null,
    });
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
      <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input type="checkbox" style={{ width: 'auto' }} checked={f.track_attendance} onChange={(e) => setF({ ...f, track_attendance: e.target.checked })} />
        Track attendance
      </label>
      <button className="primary" style={{ marginTop: 10 }}>Create &amp; mark attendance →</button>
    </form>
  );
}
