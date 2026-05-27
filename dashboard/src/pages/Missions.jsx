import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useMe } from '../App.jsx';

const TYPES = ['standalone', 'campaign', 'library'];
const STATUS = ['planning', 'active', 'completed', 'archived'];
const fmt = (ms) => (ms ? new Date(ms).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '—');

export default function Missions() {
  const { me, activeWing } = useMe();
  const [params] = useSearchParams();
  const [missions, setMissions] = useState(null);
  const [filters, setFilters] = useState({ status: '', type: '', search: '' });
  const [creating, setCreating] = useState(params.get('new') === '1');

  const load = async () => {
    if (!activeWing) return;
    const q = new URLSearchParams({ wing_id: activeWing.id });
    if (filters.status) q.set('status', filters.status);
    if (filters.type) q.set('type', filters.type);
    if (filters.search) q.set('search', filters.search);
    setMissions(await api.get(`/api/missions?${q}`));
  };
  useEffect(() => { load(); }, [activeWing, filters]);

  if (!activeWing) return <div className="empty">No wing yet. <Link to="/wing">Set one up →</Link></div>;

  return (
    <div>
      <div className="between">
        <h1>Missions</h1>
        {me.isAdmin && <button className="primary" onClick={() => setCreating((v) => !v)}>{creating ? 'Cancel' : '+ Create Mission'}</button>}
      </div>

      {creating && <CreateMission wing={activeWing} onDone={() => setCreating(false)} />}

      <div className="card" style={{ marginTop: 14 }}>
        <div className="row">
          <div style={{ flex: 1, minWidth: 160 }}>
            <label>Search</label>
            <input value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} placeholder="Mission name…" />
          </div>
          <div style={{ width: 150 }}><label>Status</label>
            <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
              <option value="">All</option>{STATUS.map((s) => <option key={s}>{s}</option>)}
            </select></div>
          <div style={{ width: 150 }}><label>Type</label>
            <select value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value })}>
              <option value="">All</option>{TYPES.map((s) => <option key={s}>{s}</option>)}
            </select></div>
        </div>
      </div>

      {missions === null ? <p className="muted">Loading…</p> : !missions.length ? (
        <div className="empty">No missions match.</div>
      ) : (
        <div className="card" style={{ padding: 0, marginTop: 14 }}>
          <table>
            <thead><tr><th>Mission</th><th>Date</th><th>Status</th><th>Type</th><th>Aircraft</th><th>Seats</th></tr></thead>
            <tbody>
              {missions.map((m) => (
                <tr key={m.id}>
                  <td><Link to={`/missions/${m.id}`} className="callsign">{m.name}</Link>
                    {m.campaign_name && <span className="small muted"> · {m.campaign_name}</span>}</td>
                  <td className="small">{fmt(m.start_at)}</td>
                  <td><span className={`badge ${m.status === 'active' ? 'active' : m.status === 'completed' ? 'qualified' : m.status === 'archived' ? 'retired' : 'reserve'}`}>{m.status}</span></td>
                  <td className="small">{m.type}</td>
                  <td className="small">{m.primary_aircraft || '—'}</td>
                  <td><span className="seat-pill">{m.seats_filled}/{m.seats_total}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CreateMission({ wing, onDone }) {
  const navigate = useNavigate();
  const [f, setF] = useState({ name: '', type: 'standalone', primary_aircraft: '', status: 'planning', start_at: '', duration_min: 90, description: '' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    if (!f.name.trim()) return;
    setBusy(true);
    try {
      const m = await api.post('/api/missions', { wing_id: wing.id, ...f });
      onDone();
      navigate(`/missions/${m.id}`);
    } finally { setBusy(false); }
  };
  return (
    <form className="card" onSubmit={submit} style={{ marginTop: 14 }}>
      <h3>Create mission</h3>
      <div className="form-grid">
        <div className="field"><label>Mission name *</label><input value={f.name} onChange={set('name')} placeholder="Operation Thunder Strike" /></div>
        <div className="field"><label>Primary aircraft</label><input value={f.primary_aircraft} onChange={set('primary_aircraft')} placeholder="F-14B Tomcat" /></div>
        <div className="field"><label>Type</label><select value={f.type} onChange={set('type')}>{TYPES.map((t) => <option key={t}>{t}</option>)}</select></div>
        <div className="field"><label>Status</label><select value={f.status} onChange={set('status')}>{STATUS.map((s) => <option key={s}>{s}</option>)}</select></div>
        <div className="field"><label>Date &amp; time</label><input type="datetime-local" value={f.start_at} onChange={set('start_at')} /></div>
        <div className="field"><label>Duration (min)</label><input type="number" value={f.duration_min} onChange={set('duration_min')} /></div>
      </div>
      <div className="field"><label>Description</label><textarea rows={3} value={f.description} onChange={set('description')} placeholder="Objectives, threats, notes…" /></div>
      <button className="primary" disabled={busy}>Create &amp; configure flights →</button>
    </form>
  );
}
