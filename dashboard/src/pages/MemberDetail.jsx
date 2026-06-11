import { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useMe } from '../App.jsx';
import { GradePill } from './Carriers.jsx';

const STATUS = ['active', 'reserve', 'loa', 'retired'];
const QUAL_STATUS = ['qualified', 'training', 'expired'];
export const CAPABILITIES = ['JTAC', 'GM', 'ATC', 'LSO', 'IP', 'AWACS', 'FAC'];

export default function MemberDetail() {
  const { id } = useParams();
  const { me } = useMe();
  const navigate = useNavigate();
  const [m, setM] = useState(null);
  const [quals, setQuals] = useState([]);
  const [trapData, setTrapData] = useState(null);

  const load = async () => {
    // Traps only need the member id from the URL, so fire it immediately —
    // it then overlaps the member→quals chain instead of waiting behind it
    // (saves a round-trip on the EU server). Quals still needs member.wing_id.
    api.get(`/api/members/${id}/traps`).then(setTrapData).catch(() => setTrapData(null));
    const member = await api.get(`/api/members/${id}`);
    setM(member);
    setQuals(await api.get(`/api/quals?wing_id=${member.wing_id}`));
  };
  useEffect(() => { load(); }, [id]);

  if (!m) return <p className="muted">Loading…</p>;

  const isSelf = me.user && m.discord_user_id === me.user.id;
  const canEdit = me.isAdmin || isSelf;

  const del = async () => {
    if (!confirm(`Remove ${m.callsign || m.name}?`)) return;
    await api.del(`/api/members/${m.id}`);
    navigate('/');
  };

  return (
    <div>
      <div className="crumbs"><Link to="/">Wing</Link> / {m.squadron_id ? <Link to={`/squadrons/${m.squadron_id}`}>Squadron</Link> : 'Wing staff'} / {m.callsign || m.name}</div>
      <div className="between">
        <h1>{m.callsign || m.name || `Member #${m.id}`}
          {m.app_role !== 'member' && <span className={`badge ${m.app_role}`} style={{ marginLeft: 8 }}>{m.app_role}</span>}
          {(m.capabilities || '').split(',').filter(Boolean).map((c) => (
            <span key={c} className="badge cap" style={{ marginLeft: 6, background: 'var(--accent-soft)', color: 'var(--accent)' }}>{c}</span>
          ))}
        </h1>
        {me.isAdmin && <button className="danger small" onClick={del}>Delete</button>}
      </div>

      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 340px' }}>
          <Profile m={m} canEdit={canEdit} isAdmin={me.isAdmin} onSaved={load} />
        </div>
        <div style={{ flex: '1 1 340px' }}>
          <Aliases m={m} canEdit={canEdit} onChanged={load} />
          <Quals m={m} quals={quals} isAdmin={me.isAdmin} onChanged={load} />
        </div>
      </div>

      <TrapsSection data={trapData} />
      <Sorties sorties={m.sorties} />
    </div>
  );
}

function TrapsSection({ data }) {
  if (!data || !data.traps?.length) return null;
  const { stats, traps } = data;
  return (
    <section>
      <h2>Traps <span className="muted small">({stats.total} total · {stats.boardings}/{stats.attempts} boarded)</span></h2>
      <div className="row" style={{ marginBottom: 10, gap: 16 }}>
        <span><b>Avg score:</b> {stats.avg_score ?? '—'}</span>
        <span><b>%-trap:</b> {stats.boarding_rate != null ? `${Math.round(stats.boarding_rate * 100)}%` : '—'}</span>
        <span><b>Last 10:</b> {stats.last_grades.map((g, i) => <GradePill key={i} g={g} />)}</span>
      </div>
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead><tr><th>Time</th><th>Carrier</th><th>Grade</th><th>Wire</th><th>A/C</th><th>Comments</th></tr></thead>
          <tbody>
            {traps.map((t) => (
              <tr key={t.id}>
                <td className="small mono">{new Date(t.time_at).toLocaleString()}</td>
                <td className="small">{t.carrier_name} <span className="muted">{t.hull}</span></td>
                <td><GradePill g={t.grade} /></td>
                <td className="small mono">{t.wire ?? '—'}</td>
                <td className="small">{t.airframe || '—'}</td>
                <td className="small muted">{t.comments ? t.comments.slice(0, 80) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Profile({ m, canEdit, isAdmin, onSaved }) {
  const [f, setF] = useState(m);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setF(m); }, [m]);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try { await api.put(`/api/members/${m.id}`, f); onSaved(); }
    finally { setBusy(false); }
  };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  if (!canEdit) {
    return (
      <section className="card">
        <h3>Profile</h3>
        <dl className="small">
          <Field label="Name" value={m.name} />
          <Field label="Rank" value={m.rank} />
          <Field label="Billet" value={m.billet} />
          <Field label="Airframes" value={m.airframes} />
          <Field label="Status" value={m.status} />
        </dl>
      </section>
    );
  }
  return (
    <section className="card">
      <h3>Profile</h3>
      <form onSubmit={save}>
        <div className="form-grid">
          <div className="field"><label>Callsign</label><input value={f.callsign || ''} onChange={set('callsign')} /></div>
          <div className="field"><label>Name</label><input value={f.name || ''} onChange={set('name')} /></div>
          <div className="field"><label>Airframes</label><input value={f.airframes || ''} onChange={set('airframes')} /></div>
          {isAdmin && <div className="field"><label>Rank</label><input value={f.rank || ''} onChange={set('rank')} /></div>}
          {isAdmin && <div className="field"><label>Billet</label><input value={f.billet || ''} onChange={set('billet')} /></div>}
          {isAdmin && <div className="field"><label>Status</label>
            <select value={f.status} onChange={set('status')}>{STATUS.map((s) => <option key={s}>{s}</option>)}</select></div>}
          {isAdmin && <div className="field"><label>App role</label>
            <select value={f.app_role} onChange={set('app_role')}>{['member', 'commander', 'admin'].map((s) => <option key={s}>{s}</option>)}</select></div>}
          {isAdmin && <div className="field"><label>Discord user ID</label><input value={f.discord_user_id || ''} onChange={set('discord_user_id')} placeholder="link a Discord account" /></div>}
        </div>
        {isAdmin && <CapabilitiesField value={f.capabilities || ''} onChange={(v) => setF({ ...f, capabilities: v })} />}
        <button className="primary" disabled={busy}>Save</button>
      </form>
    </section>
  );
}

function CapabilitiesField({ value, onChange }) {
  const set = new Set(String(value || '').split(',').map((t) => t.trim()).filter(Boolean));
  const toggle = (t) => {
    if (set.has(t)) set.delete(t); else set.add(t);
    onChange([...set].join(','));
  };
  return (
    <div className="field">
      <label>Capabilities <span className="muted small">(JTAC / GM / ATC / LSO / IP / AWACS / FAC)</span></label>
      <div className="chip-row">
        {CAPABILITIES.map((c) => {
          const on = set.has(c);
          return (
            <button type="button" key={c} className={on ? 'chip on' : 'chip'} onClick={() => toggle(c)}
              style={{
                cursor: 'pointer',
                background: on ? 'var(--accent)' : 'transparent',
                color: on ? '#000' : 'var(--fg)',
                border: '1px solid var(--accent)',
              }}>{c}</button>
          );
        })}
      </div>
    </div>
  );
}

function Field({ label, value }) {
  return <div style={{ display: 'flex', gap: 8, padding: '3px 0' }}><span className="muted" style={{ width: 90 }}>{label}</span><span>{value || '—'}</span></div>;
}

function Aliases({ m, canEdit, onChanged }) {
  const [alias, setAlias] = useState('');
  const [err, setErr] = useState('');
  const add = async (e) => {
    e.preventDefault();
    setErr('');
    if (!alias.trim()) return;
    try {
      const r = await api.post(`/api/members/${m.id}/aliases`, { alias });
      setAlias('');
      onChanged();
      if (r.relinked) setErr(`Linked ${r.relinked} past sortie(s).`);
    } catch (e2) {
      setErr(e2.message === 'alias_taken' ? 'That in-game name is already claimed by someone else.' : 'Could not add alias.');
    }
  };
  const remove = async (aid) => { await api.del(`/api/aliases/${aid}`); onChanged(); };
  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <h3>In-game names (pilot aliases)</h3>
      <p className="muted small" style={{ marginTop: 0 }}>
        The exact pilot name as it appears in DCS. This is what links sortie telemetry to this member.
      </p>
      <div className="chip-row">
        {(m.aliases || []).length === 0 && <span className="muted small">No names claimed yet.</span>}
        {(m.aliases || []).map((a) => (
          <span key={a.id} className="chip">{a.alias}{canEdit && <button onClick={() => remove(a.id)} title="Remove">×</button>}</span>
        ))}
      </div>
      {canEdit && (
        <form className="row" onSubmit={add} style={{ marginTop: 10, alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}><input value={alias} onChange={(e) => setAlias(e.target.value)} placeholder='e.g. "Maverick" or "[VF-1] Maverick"' /></div>
          <button className="small">Claim name</button>
        </form>
      )}
      {err && <p className="small muted" style={{ marginTop: 8 }}>{err}</p>}
    </section>
  );
}

function Quals({ m, quals, isAdmin, onChanged }) {
  const held = new Map((m.quals || []).map((q) => [q.qual_id, q]));
  const setQual = async (qualId, status) => {
    if (status === 'none') await api.del(`/api/members/${m.id}/quals/${qualId}`);
    else await api.put(`/api/members/${m.id}/quals/${qualId}`, { status });
    onChanged();
  };
  return (
    <section className="card">
      <h3>Qualifications</h3>
      {quals.length === 0 && <p className="muted small">No quals defined for this wing yet.</p>}
      {quals.map((q) => {
        const cur = held.get(q.id);
        return (
          <div key={q.id} className="between" style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
            <div><strong>{q.code}</strong> <span className="muted small">{q.name}</span>
              {cur?.progress?.total > 0 && (
                <span className="qprog" title={`${cur.progress.signed}/${cur.progress.total} activities`} style={{ marginLeft: 8 }}>
                  <span style={{ width: `${(cur.progress.signed / cur.progress.total) * 100}%` }} />
                </span>
              )}
            </div>
            {isAdmin ? (
              <select value={cur?.status || 'none'} onChange={(e) => setQual(q.id, e.target.value)} style={{ width: 130 }}>
                <option value="none">—</option>
                {QUAL_STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            ) : (
              cur ? <span className={`badge ${cur.status}`}>{cur.status}</span> : <span className="muted small">—</span>
            )}
          </div>
        );
      })}
    </section>
  );
}

function Sorties({ sorties }) {
  if (!sorties || !sorties.length) {
    return <section><h2>Logbook</h2><div className="empty">No sorties recorded yet.</div></section>;
  }
  return (
    <section>
      <h2>Logbook</h2>
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead><tr><th>Pilot name</th><th>Airframe</th><th>Duration</th><th>Logged</th></tr></thead>
          <tbody>
            {sorties.map((s) => (
              <tr key={s.id}>
                <td>{s.alias}</td>
                <td>{s.airframe || '—'}</td>
                <td>{Math.round((s.seconds || 0) / 60)} min</td>
                <td className="small muted">{new Date(s.created_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
