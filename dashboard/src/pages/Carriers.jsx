import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useMe } from '../App.jsx';

export default function Carriers() {
  const { me, activeWing } = useMe();
  const [carriers, setCarriers] = useState(null);
  const [board, setBoard] = useState(null);
  const [creating, setCreating] = useState(false);

  const load = async () => {
    if (!activeWing) return;
    setCarriers(await api.get(`/api/wings/${activeWing.id}/carriers`));
    setBoard(await api.get(`/api/wings/${activeWing.id}/greenie-board`));
  };
  useEffect(() => { load(); }, [activeWing]);

  if (!activeWing) return <div className="empty">No wing yet. <Link to="/wing">Set one up →</Link></div>;

  return (
    <div>
      <div className="between">
        <h1>Carriers</h1>
        {me.isAdmin && <button className="primary" onClick={() => setCreating((v) => !v)}>{creating ? 'Cancel' : '+ Add carrier'}</button>}
      </div>

      {creating && <CreateCarrier wing={activeWing} onDone={() => { setCreating(false); load(); }} />}

      <section>
        <h2>Ships</h2>
        {carriers === null ? <p className="muted">Loading…</p> : !carriers.length ? (
          <div className="empty">No carriers yet. Add one to start logging traps.</div>
        ) : (
          <div className="card" style={{ padding: 0 }}>
            <table>
              <thead><tr><th>Name</th><th>Hull</th><th>Class</th><th></th></tr></thead>
              <tbody>
                {carriers.map((c) => (
                  <tr key={c.id}>
                    <td><Link to={`/carriers/${c.id}`} className="callsign">{c.name}</Link></td>
                    <td className="small">{c.hull || '—'}</td>
                    <td className="small">{c.class || '—'}</td>
                    <td className="small muted">{c.notes ? c.notes.slice(0, 60) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <GreenieBoard board={board} />
    </div>
  );
}

function CreateCarrier({ wing, onDone }) {
  const [f, setF] = useState({ name: '', hull: '', class: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    if (!f.name.trim()) return;
    setBusy(true);
    try {
      await api.post(`/api/wings/${wing.id}/carriers`, f);
      onDone();
    } finally { setBusy(false); }
  };
  return (
    <form className="card" onSubmit={submit} style={{ marginTop: 14 }}>
      <h3>Add carrier</h3>
      <div className="form-grid">
        <div className="field"><label>Name *</label><input value={f.name} onChange={set('name')} placeholder="USS Abraham Lincoln" /></div>
        <div className="field"><label>Hull</label><input value={f.hull} onChange={set('hull')} placeholder="CVN-72" /></div>
        <div className="field"><label>Class</label><input value={f.class} onChange={set('class')} placeholder="Nimitz" /></div>
      </div>
      <div className="field"><label>Notes</label><textarea rows={2} value={f.notes} onChange={set('notes')} /></div>
      <button className="primary" disabled={busy}>Add</button>
    </form>
  );
}

function GreenieBoard({ board }) {
  if (!board) return null;
  return (
    <section>
      <h2>Greenie board <span className="muted small">(last 10 traps · ordered by avg score)</span></h2>
      {!board.board.length ? <div className="empty">No traps logged yet.</div> : (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead><tr><th>Pilot</th><th>Avg</th><th>%-trap</th><th>Last 10 (newest →)</th></tr></thead>
            <tbody>
              {board.board.map((row) => (
                <tr key={row.member_id}>
                  <td><Link to={`/members/${row.member_id}`} className="callsign">{row.callsign || row.name}</Link></td>
                  <td><b>{row.avg_score ?? '—'}</b></td>
                  <td>{row.boarding_rate != null ? `${Math.round(row.boarding_rate * 100)}%` : '—'}</td>
                  <td className="small mono">
                    {row.grades.map((g, i) => <GradePill key={i} g={g} />)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function GradePill({ g }) {
  const color = ({
    '_OK_': '#3aff8a', 'OK': '#4cd964', '(OK)': '#ffd60a',
    '--': '#a07a3a', 'B': '#ff9500', 'TWO': '#ff9500',
    'C': '#ff453a', 'WO': '#ff453a', 'WOFD': '#7a7a7a',
  })[g] || '#888';
  return (
    <span style={{
      display: 'inline-block', padding: '2px 6px', marginRight: 4,
      borderRadius: 4, background: color, color: '#000',
      fontSize: 11, fontWeight: 700, minWidth: 24, textAlign: 'center',
    }}>{g}</span>
  );
}
