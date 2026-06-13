import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api.js';
import { useMe } from '../App.jsx';
import { GradePill } from './Carriers.jsx';

const GRADES = ['_OK_', 'OK', '(OK)', '--', 'B', 'TWO', 'C', 'WO', 'WOFD'];
const AOAS = ['', 'HI', 'OK', 'LO'];
const LINEUPS = ['', 'LUL', 'OK', 'LUR'];
const GS = ['', 'HI', 'OK', 'LO'];

const fmt = (ms) => (ms ? new Date(ms).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '—');

export default function CarrierDetail() {
  const { id } = useParams();
  const { me, activeWing } = useMe();
  const [carrier, setCarrier] = useState(null);
  const [members, setMembers] = useState([]);
  const [logging, setLogging] = useState(false);

  const load = async () => {
    setCarrier(await api.get(`/api/carriers/${id}`));
  };
  useEffect(() => { load(); }, [id]);
  useEffect(() => {
    if (activeWing) api.get(`/api/members?wing_id=${activeWing.id}`).then(setMembers).catch(() => setMembers([]));
  }, [activeWing]);

  if (!carrier) return <p className="muted">Loading…</p>;

  return (
    <div>
      <p className="small muted"><Link to="/carriers">← Carriers</Link></p>
      <div className="between">
        <div>
          <h1>{carrier.name} {carrier.hull && <span className="muted">{carrier.hull}</span>}</h1>
          <p className="small muted">{carrier.class || '—'} class</p>
        </div>
        {me.isAdmin && <button className="primary" onClick={() => setLogging((v) => !v)}>{logging ? 'Cancel' : '+ Log trap'}</button>}
      </div>

      {logging && <LogTrap carrierId={carrier.id} members={members} onDone={() => { setLogging(false); load(); }} />}

      <section>
        <h2>Recent traps <span className="muted small">({carrier.recent_traps.length})</span></h2>
        {!carrier.recent_traps.length ? <div className="empty">No traps logged yet.</div> : (
          <div className="card" style={{ padding: 0 }}>
            <table>
              <thead><tr>
                <th>Time</th><th>Pilot</th><th>Grade</th><th>Wire</th>
                <th>A/C</th><th>AOA</th><th>L/U</th><th>G/S</th><th>Comments</th>
              </tr></thead>
              <tbody>
                {carrier.recent_traps.map((t) => (
                  <tr key={t.id}>
                    <td className="small mono">{fmt(t.time_at)}</td>
                    <td>
                      {t.member_id
                        ? <Link to={`/members/${t.member_id}`} className="callsign">{t.callsign || t.member_name}</Link>
                        : <span className="muted">{t.pilot_name || '—'}</span>}
                    </td>
                    <td><GradePill g={t.grade} /></td>
                    <td className="small mono">{t.wire ?? '—'}</td>
                    <td className="small">{t.airframe || '—'}</td>
                    <td className="small">{t.aoa || '—'}</td>
                    <td className="small">{t.lineup || '—'}</td>
                    <td className="small">{t.glideslope || '—'}</td>
                    <td className="small muted">{t.comments ? t.comments.slice(0, 80) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function LogTrap({ carrierId, members, onDone }) {
  const localIso = () => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  };
  const [f, setF] = useState({
    member_id: '', pilot_name: '', airframe: '', grade: 'OK', wire: 3,
    aoa: 'OK', lineup: 'OK', glideslope: 'OK', ball_call: '', comments: '',
    time_at: localIso(),
  });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const payload = {
        ...f,
        member_id: f.member_id ? Number(f.member_id) : null,
        time_at: f.time_at ? new Date(f.time_at).getTime() : Date.now(),
        wire: f.wire === '' ? null : Number(f.wire),
      };
      await api.post(`/api/carriers/${carrierId}/traps`, payload);
      onDone();
    } catch (err) {
      alert(`Log failed: ${err.message}`);
    } finally { setBusy(false); }
  };
  const noWire = ['B', 'WO', 'WOFD', 'TWO'].includes(f.grade);
  return (
    <form className="card" onSubmit={submit} style={{ marginTop: 14 }}>
      <h3>Log trap</h3>
      <div className="form-grid">
        <div className="field"><label>Pilot</label>
          <select value={f.member_id} onChange={set('member_id')}>
            <option value="">— select —</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.callsign || m.name}</option>)}
          </select></div>
        <div className="field"><label>Pilot name (override)</label>
          <input value={f.pilot_name} onChange={set('pilot_name')} placeholder="(only if not in roster)" /></div>
        <div className="field"><label>Airframe</label><input value={f.airframe} onChange={set('airframe')} placeholder="F-18C" /></div>
        <div className="field"><label>Time</label><input type="datetime-local" value={f.time_at} onChange={set('time_at')} /></div>
        <div className="field"><label>Grade *</label>
          <select value={f.grade} onChange={set('grade')}>
            {GRADES.map((g) => <option key={g}>{g}</option>)}
          </select></div>
        <div className="field"><label>Wire</label>
          <select value={noWire ? '' : f.wire} onChange={set('wire')} disabled={noWire}>
            {['', 1, 2, 3, 4].map((w) => <option key={w} value={w}>{w === '' ? '—' : w}</option>)}
          </select></div>
        <div className="field"><label>AOA</label>
          <select value={f.aoa} onChange={set('aoa')}>{AOAS.map((v) => <option key={v}>{v}</option>)}</select></div>
        <div className="field"><label>Line-up</label>
          <select value={f.lineup} onChange={set('lineup')}>{LINEUPS.map((v) => <option key={v}>{v}</option>)}</select></div>
        <div className="field"><label>Glideslope</label>
          <select value={f.glideslope} onChange={set('glideslope')}>{GS.map((v) => <option key={v}>{v}</option>)}</select></div>
      </div>
      <div className="field"><label>Ball call</label><input value={f.ball_call} onChange={set('ball_call')} placeholder='"207 Hornet ball 3.2 auto"' /></div>
      <div className="field"><label>LSO comments</label><textarea rows={2} value={f.comments} onChange={set('comments')} placeholder="Comments, deviations, conditions…" /></div>
      <button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Log trap'}</button>
    </form>
  );
}
