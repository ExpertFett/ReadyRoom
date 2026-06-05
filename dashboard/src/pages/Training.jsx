/**
 * IP Training Dashboard — instructor-facing per-pilot session log.
 *
 * Mirrors Deckboss's Training tab. One row per active pilot grouped by
 * subdivision, columns: rank · callsign · modex · sessions · hours · last
 * session. Admins log new sessions via a + Log Session form.
 *
 * Training sessions are distinct from sorties: sorties are passive flight
 * time from the DCS hook, sessions are deliberate instructor-led training.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useMe } from '../App.jsx';

const SUBDIV_ORDER = ['candidate', 'frs', 'main', 'ready_reserve'];
const SUBDIV_LABEL = {
  main: 'MAIN',
  ready_reserve: 'READY RESERVE',
  candidate: 'CANDIDATE',
  frs: 'FRS',
};

const fmt = (ms) => (ms ? new Date(ms).toLocaleDateString() : '—');

export default function Training() {
  const { me, activeWing } = useMe();
  const [summary, setSummary] = useState(null);
  const [logging, setLogging] = useState(false);

  const load = async () => {
    if (!activeWing) return;
    setSummary(await api.get(`/api/wings/${activeWing.id}/training-summary`));
  };
  useEffect(() => { load(); }, [activeWing]);

  if (!activeWing) return <div className="empty">No wing yet.</div>;
  if (!summary) return <p className="muted">Loading…</p>;

  // Aggregate totals + per-subdivision groupings.
  const totalSessions = summary.reduce((a, b) => a + (b.sessions || 0), 0);
  const totalHours = Math.round(summary.reduce((a, b) => a + (b.total_minutes || 0), 0) / 60 * 10) / 10;
  const grouped = SUBDIV_ORDER
    .map((s) => ({ subdivision: s, rows: summary.filter((r) => r.subdivision === s) }))
    .filter((g) => g.rows.length);

  return (
    <div>
      <div className="between">
        <div>
          <h1>IP Training Dashboard</h1>
          <p className="muted">
            Pilots: <b>{summary.length}</b> · Total Sessions: <b>{totalSessions}</b> · Total Hours: <b>{totalHours}</b>
          </p>
        </div>
        {me.isAdmin && <button className="primary" onClick={() => setLogging((v) => !v)}>
          {logging ? 'Cancel' : '+ Log session'}
        </button>}
      </div>

      {logging && <LogSession wing={activeWing} onDone={() => { setLogging(false); load(); }} />}

      {grouped.map((g) => <SubdivisionTable key={g.subdivision} group={g} />)}
    </div>
  );
}

function SubdivisionTable({ group }) {
  return (
    <section style={{ marginTop: 14 }}>
      <div className="card" style={{ background: 'rgba(255,255,255,0.04)', padding: '6px 12px', marginBottom: 0, borderRadius: '6px 6px 0 0' }}>
        <div className="between">
          <h3 style={{ margin: 0, letterSpacing: 1 }}>{SUBDIV_LABEL[group.subdivision] || group.subdivision.toUpperCase()}</h3>
          <span className="muted small">{group.rows.length} pilots</span>
        </div>
      </div>
      <div className="card" style={{ padding: 0, borderRadius: '0 0 6px 6px', marginTop: 0 }}>
        <table>
          <thead><tr>
            <th>Rank</th><th>Callsign</th><th>Modex</th>
            <th style={{ textAlign: 'right' }}>Sessions</th>
            <th style={{ textAlign: 'right' }}>Hours</th>
            <th>Last Session</th>
          </tr></thead>
          <tbody>
            {group.rows.map((r) => (
              <tr key={r.id}>
                <td className="small muted">{r.rank || '—'}</td>
                <td><Link to={`/members/${r.id}`} className="callsign">{r.callsign || r.name || `#${r.id}`}</Link></td>
                <td className="small mono">{r.modex || '—'}</td>
                <td style={{ textAlign: 'right' }}><b>{r.sessions}</b></td>
                <td style={{ textAlign: 'right' }}>{r.total_hours}</td>
                <td className="small">{fmt(r.last_session_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function LogSession({ wing, onDone }) {
  const localIso = () => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  };
  const [members, setMembers] = useState([]);
  const [quals, setQuals] = useState([]);
  const [f, setF] = useState({
    pilot_member_id: '', instructor_member_id: '', qual_id: '',
    started_at: localIso(), duration_minutes: 60, topics: '', notes: '',
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get(`/api/members?wing_id=${wing.id}`).then(setMembers);
    api.get(`/api/quals?wing_id=${wing.id}`).then(setQuals);
  }, [wing.id]);

  const submit = async (e) => {
    e.preventDefault();
    if (!f.pilot_member_id) return alert('Pick a pilot.');
    setBusy(true);
    try {
      await api.post(`/api/wings/${wing.id}/training-sessions`, {
        pilot_member_id: Number(f.pilot_member_id),
        instructor_member_id: f.instructor_member_id ? Number(f.instructor_member_id) : null,
        qual_id: f.qual_id ? Number(f.qual_id) : null,
        started_at: new Date(f.started_at).getTime(),
        duration_minutes: Number(f.duration_minutes) || 60,
        topics: f.topics, notes: f.notes,
      });
      onDone();
    } finally { setBusy(false); }
  };

  const active = members.filter((m) => m.status === 'active');
  return (
    <form className="card" onSubmit={submit} style={{ marginTop: 12 }}>
      <h3 style={{ marginTop: 0 }}>Log training session</h3>
      <div className="form-grid">
        <div className="field"><label>Pilot *</label>
          <select value={f.pilot_member_id} onChange={(e) => setF({ ...f, pilot_member_id: e.target.value })}>
            <option value="">— select —</option>
            {active.map((m) => <option key={m.id} value={m.id}>{m.callsign || m.name} {m.modex ? `· ${m.modex}` : ''}</option>)}
          </select></div>
        <div className="field"><label>Instructor</label>
          <select value={f.instructor_member_id} onChange={(e) => setF({ ...f, instructor_member_id: e.target.value })}>
            <option value="">(none)</option>
            {active.map((m) => <option key={m.id} value={m.id}>{m.callsign || m.name}</option>)}
          </select></div>
        <div className="field"><label>Linked qual</label>
          <select value={f.qual_id} onChange={(e) => setF({ ...f, qual_id: e.target.value })}>
            <option value="">(none)</option>
            {quals.map((q) => <option key={q.id} value={q.id}>{q.code} · {q.name}</option>)}
          </select></div>
        <div className="field"><label>Start</label>
          <input type="datetime-local" value={f.started_at} onChange={(e) => setF({ ...f, started_at: e.target.value })} /></div>
        <div className="field"><label>Duration (minutes)</label>
          <input type="number" min="0" value={f.duration_minutes} onChange={(e) => setF({ ...f, duration_minutes: e.target.value })} /></div>
      </div>
      <div className="field"><label>Topics covered</label>
        <input value={f.topics} onChange={(e) => setF({ ...f, topics: e.target.value })} placeholder="Cold start, ground handling, taxi…" /></div>
      <div className="field"><label>Notes</label>
        <textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Debrief notes, areas to improve…" /></div>
      <button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Log session'}</button>
    </form>
  );
}
