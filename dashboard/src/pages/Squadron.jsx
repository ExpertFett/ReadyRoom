import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useMe } from '../App.jsx';

const STATUS = ['active', 'reserve', 'loa', 'retired'];

export default function Squadron() {
  const { id } = useParams();
  const { me } = useMe();
  const [sqn, setSqn] = useState(null);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);

  const load = async () => setSqn(await api.get(`/api/squadrons/${id}`));
  useEffect(() => { load(); }, [id]);

  if (!sqn) return <p className="muted">Loading…</p>;

  return (
    <div>
      <div className="crumbs"><Link to="/">Wing</Link> / {sqn.tag || sqn.name}</div>
      <div className="between">
        <div>
          <h1>{sqn.tag ? `${sqn.tag} — ` : ''}{sqn.name}</h1>
          {sqn.aircraft && <p className="muted">{sqn.aircraft}{sqn.description ? ` · ${sqn.description}` : ''}</p>}
        </div>
        {me.isAdmin && (
          <div className="row">
            <button className="small" onClick={() => { setImporting(false); setAdding((v) => !v); }}>{adding ? 'Cancel' : '+ Member'}</button>
            <button className="small" onClick={() => { setAdding(false); setImporting((v) => !v); }}>{importing ? 'Cancel' : 'Import CSV'}</button>
          </div>
        )}
      </div>

      {adding && <AddMember sqn={sqn} onDone={() => { setAdding(false); load(); }} />}
      {importing && <ImportCsv sqn={sqn} onDone={() => { setImporting(false); load(); }} />}

      {!sqn.members.length ? (
        <div className="empty">No members yet.</div>
      ) : (
        <div className="card" style={{ padding: 0, marginTop: 14 }}>
          <table>
            <thead><tr><th>Callsign</th><th>Name</th><th>Rank</th><th>Billet</th><th>Airframes</th><th>Status</th></tr></thead>
            <tbody>
              {sqn.members.map((m) => (
                <tr key={m.id}>
                  <td><Link to={`/members/${m.id}`} className="callsign">{m.callsign || '—'}</Link>
                    {m.app_role !== 'member' && <span className={`badge ${m.app_role}`} style={{ marginLeft: 6 }}>{m.app_role}</span>}</td>
                  <td>{m.name || '—'}</td>
                  <td>{m.rank || '—'}</td>
                  <td>{m.billet || '—'}</td>
                  <td className="small">{m.airframes || '—'}</td>
                  <td><span className={`badge ${m.status}`}>{m.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AddMember({ sqn, onDone }) {
  const empty = { callsign: '', name: '', rank: '', billet: '', airframes: sqn.aircraft || '', status: 'active' };
  const [f, setF] = useState(empty);
  const submit = async (e) => {
    e.preventDefault();
    if (!f.callsign.trim() && !f.name.trim()) return;
    await api.post('/api/members', { wing_id: sqn.wing_id, squadron_id: sqn.id, ...f });
    onDone();
  };
  return (
    <form className="card" onSubmit={submit} style={{ marginTop: 14 }}>
      <div className="form-grid">
        <div className="field"><label>Callsign</label><input value={f.callsign} onChange={(e) => setF({ ...f, callsign: e.target.value })} /></div>
        <div className="field"><label>Name</label><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div className="field"><label>Rank</label><input value={f.rank} onChange={(e) => setF({ ...f, rank: e.target.value })} /></div>
        <div className="field"><label>Billet</label><input value={f.billet} onChange={(e) => setF({ ...f, billet: e.target.value })} placeholder="Pilot / CO / OPSO" /></div>
        <div className="field"><label>Airframes</label><input value={f.airframes} onChange={(e) => setF({ ...f, airframes: e.target.value })} /></div>
        <div className="field"><label>Status</label>
          <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
            {STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select></div>
      </div>
      <button className="primary">Add member</button>
    </form>
  );
}

function ImportCsv({ sqn, onDone }) {
  const [csv, setCsv] = useState('callsign,name,rank,billet,airframes,notes\n');
  const [result, setResult] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    setResult(await api.post(`/api/squadrons/${sqn.id}/import-roster`, { csv }));
  };
  return (
    <form className="card" onSubmit={submit} style={{ marginTop: 14 }}>
      <label>Paste CSV — header row required. Columns: callsign, name, rank, billet, airframes, notes, discord_user_id</label>
      <textarea rows={6} value={csv} onChange={(e) => setCsv(e.target.value)} style={{ fontFamily: 'monospace' }} />
      <div className="row" style={{ marginTop: 10, alignItems: 'center' }}>
        <button className="primary">Import</button>
        {result && <span className="muted small">Imported {result.imported} of {result.total} rows.</span>}
        {result && <button type="button" className="small" onClick={onDone}>Done</button>}
      </div>
    </form>
  );
}
