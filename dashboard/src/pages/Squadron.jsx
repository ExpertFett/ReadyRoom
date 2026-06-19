import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useMe } from '../App.jsx';

const STATUS = ['active', 'reserve', 'loa', 'retired'];
const SUBDIVISIONS = [
  { key: 'main', label: 'Main' },
  { key: 'ready_reserve', label: 'Ready Reserve' },
  { key: 'candidate', label: 'Candidate' },
  { key: 'frs', label: 'FRS' },
];
const TIER_ORDER = ['FMQ', 'MCQ', 'CQ', 'IQT', 'Untiered'];

const TierBadge = ({ tier }) =>
  tier ? <span className={`tier tier-${String(tier).toLowerCase()}`}>{tier}</span> : <span className="muted">—</span>;

const Quals = ({ codes }) =>
  codes && codes.length
    ? <span className="qual-codes">{codes.map((c) => <span key={c} className="qcode">{c}</span>)}</span>
    : <span className="muted">—</span>;

export default function Squadron() {
  const { id } = useParams();
  const { me } = useMe();
  const [sqn, setSqn] = useState(null);
  const [panel, setPanel] = useState(null); // 'add' | 'import' | 'attach'

  const load = async () => setSqn(await api.get(`/api/squadrons/${id}`));
  useEffect(() => { load(); setPanel(null); }, [id]);

  if (!sqn) return <p className="muted">Loading…</p>;
  const isDet = sqn.kind === 'detachment';
  const reload = () => { setPanel(null); load(); };

  return (
    <div>
      <div className="crumbs"><Link to="/wing">Wing</Link> / {sqn.tag || sqn.name}</div>
      <div className="between">
        <div>
          <h1>{sqn.tag ? `${sqn.tag} — ` : ''}{sqn.name}
            {isDet && <span className="badge commander" style={{ marginLeft: 8 }}>DETACHMENT</span>}</h1>
          {sqn.aircraft && <p className="muted">{sqn.aircraft}{sqn.description ? ` · ${sqn.description}` : ''}</p>}
        </div>
        {me.isAdmin && (
          <div className="row">
            <button className="small" onClick={() => setPanel(panel === 'add' ? null : 'add')}>+ Member</button>
            {isDet && <button className="small" onClick={() => setPanel(panel === 'attach' ? null : 'attach')}>Attach pilot</button>}
            <button className="small" onClick={() => setPanel(panel === 'import' ? null : 'import')}>Import CSV</button>
          </div>
        )}
      </div>

      <Readiness readiness={sqn.readiness} />

      {panel === 'add' && <AddMember sqn={sqn} onDone={reload} />}
      {panel === 'attach' && <AttachPilot sqn={sqn} onDone={reload} />}
      {panel === 'import' && <ImportCsv sqn={sqn} onDone={reload} />}

      {isDet ? (
        <DetachmentRoster sqn={sqn} />
      ) : (
        <SquadronRoster sqn={sqn} />
      )}
    </div>
  );
}

function Readiness({ readiness }) {
  if (!readiness || !readiness.total) return null;
  const tiers = readiness.tiers || {};
  const keys = [...TIER_ORDER.filter((t) => tiers[t]), ...Object.keys(tiers).filter((t) => !TIER_ORDER.includes(t))];
  return (
    <div className="card readiness" style={{ marginTop: 14 }}>
      <div className="between">
        <h3 style={{ margin: 0 }}>Readiness</h3>
        <span className="muted small">{readiness.total} personnel</span>
      </div>
      <div className="chip-row" style={{ marginTop: 10 }}>
        {keys.map((t) => (
          <span key={t} className="chip"><TierBadge tier={t === 'Untiered' ? null : t} />{t === 'Untiered' && <span className="muted">Untiered</span>}<strong style={{ marginLeft: 4 }}>{tiers[t]}</strong></span>
        ))}
      </div>
    </div>
  );
}

function MemberRow({ m, extra }) {
  return (
    <tr>
      <td className="small muted">{m.modex || '—'}</td>
      <td><Link to={`/members/${m.id}`} className="callsign">{m.callsign || '—'}</Link>
        {m.app_role && m.app_role !== 'member' && <span className={`badge ${m.app_role}`} style={{ marginLeft: 6 }}>{m.app_role}</span>}
        {(m.capabilities || '').split(',').filter(Boolean).map((c) => (
          <span key={c} className="badge cap" style={{ marginLeft: 4, fontSize: 10, padding: '1px 5px', background: 'var(--accent-soft, rgba(76,139,245,0.15))', color: 'var(--accent, #4c8bf5)' }}>{c}</span>
        ))}</td>
      <td>{m.name || '—'}</td>
      <td className="small">{m.rank || '—'}</td>
      {extra}
      <td><Quals codes={m.qual_codes} /></td>
      <td><TierBadge tier={m.tier} /></td>
      <td><span className={`badge ${m.status}`}>{m.status}</span></td>
    </tr>
  );
}

function SquadronRoster({ sqn }) {
  const groups = (sqn.roster || []).filter((g) => g.members.length);
  if (!groups.length) return <div className="empty">No members yet.</div>;
  return (
    <>
      {groups.map((g) => (
        <section key={g.key}>
          <h2>{g.label} <span className="muted small">({g.members.length})</span></h2>
          <div className="card" style={{ padding: 0 }}>
            <table>
              <thead><tr><th>Modex</th><th>Callsign</th><th>Name</th><th>Rank</th><th>Billet</th><th>Quals</th><th>Tier</th><th>Status</th></tr></thead>
              <tbody>
                {g.members.map((m) => <MemberRow key={m.id} m={m} extra={<td className="small">{m.billet || '—'}</td>} />)}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </>
  );
}

function DetachmentRoster({ sqn }) {
  const roster = sqn.det_roster || [];
  if (!roster.length) return <div className="empty" style={{ marginTop: 14 }}>No pilots assigned. Add organic members or attach pilots from other squadrons.</div>;
  return (
    <section>
      <h2>Detachment roster <span className="muted small">({roster.length})</span></h2>
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead><tr><th>Modex</th><th>Callsign</th><th>Name</th><th>Rank</th><th>Attach</th><th>Quals</th><th>Tier</th><th>Status</th></tr></thead>
          <tbody>
            {roster.map((m) => (
              <MemberRow key={`${m.id}-${m.attach_type}`} m={m} extra={
                <td className="small">
                  <span className={`badge ${m.attach_type === 'FT' ? 'active' : 'reserve'}`}>{m.attach_type}</span>
                  {m.home_tag && <span className="muted"> {m.home_tag}</span>}
                </td>
              } />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AddMember({ sqn, onDone }) {
  const [f, setF] = useState({
    callsign: '', name: '', rank: '', billet: '', modex: '', livery: '',
    airframes: sqn.aircraft || '', subdivision: 'main', status: 'active',
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    if (!f.callsign.trim() && !f.name.trim()) return;
    await api.post('/api/members', { wing_id: sqn.wing_id, squadron_id: sqn.id, ...f });
    onDone();
  };
  return (
    <form className="card" onSubmit={submit} style={{ marginTop: 14 }}>
      <div className="form-grid">
        <div className="field"><label>Callsign</label><input value={f.callsign} onChange={set('callsign')} placeholder="Maverick" /></div>
        <div className="field"><label>Name</label><input value={f.name} onChange={set('name')} placeholder="Pete Mitchell" /></div>
        <div className="field"><label>Modex</label><input value={f.modex} onChange={set('modex')} placeholder="400" /></div>
        <div className="field"><label>Livery</label><input value={f.livery} onChange={set('livery')} placeholder="DCS livery / skin name" /></div>
        <div className="field"><label>Rank</label><input value={f.rank} onChange={set('rank')} placeholder="LT" /></div>
        <div className="field"><label>Billet</label><input value={f.billet} onChange={set('billet')} placeholder="Pilot / CO / OPSO" /></div>
        <div className="field"><label>Airframes</label><input value={f.airframes} onChange={set('airframes')} /></div>
        {!sqn.kind || sqn.kind === 'squadron' ? (
          <div className="field"><label>Subdivision</label>
            <select value={f.subdivision} onChange={set('subdivision')}>
              {SUBDIVISIONS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select></div>
        ) : null}
        <div className="field"><label>Status</label>
          <select value={f.status} onChange={set('status')}>{STATUS.map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
      </div>
      <button className="primary">Add member</button>
    </form>
  );
}

function AttachPilot({ sqn, onDone }) {
  const [members, setMembers] = useState([]);
  const [memberId, setMemberId] = useState('');
  const [type, setType] = useState('PT');
  useEffect(() => { api.get(`/api/members?wing_id=${sqn.wing_id}`).then((all) => setMembers(all.filter((m) => m.squadron_id !== sqn.id))); }, [sqn.id]);
  const submit = async (e) => {
    e.preventDefault();
    if (!memberId) return;
    await api.post(`/api/squadrons/${sqn.id}/attach`, { member_id: Number(memberId), attach_type: type });
    onDone();
  };
  return (
    <form className="card" onSubmit={submit} style={{ marginTop: 14 }}>
      <h3 style={{ marginTop: 0 }}>Attach a pilot from another squadron</h3>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <div style={{ flex: 1, minWidth: 220 }}><label>Pilot</label>
          <select value={memberId} onChange={(e) => setMemberId(e.target.value)}>
            <option value="">— select pilot —</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.callsign || m.name} {m.modex ? `(${m.modex})` : ''}</option>)}
          </select></div>
        <div style={{ width: 120 }}><label>Type</label>
          <select value={type} onChange={(e) => setType(e.target.value)}><option value="PT">PT (cross-attached)</option><option value="FT">FT</option></select></div>
        <button className="small primary">Attach</button>
      </div>
    </form>
  );
}

function ImportCsv({ sqn, onDone }) {
  const [csv, setCsv] = useState(
    'callsign,name,rank,billet,modex,subdivision,airframes,capabilities,discord_user_id,notes\n' +
    'Maverick,Pete Mitchell,LT,Pilot,400,main,F-14B,,, \n' +
    'Goose,Nick Bradshaw,LTJG,RIO,401,main,F-14B,,,\n' +
    'Iceman,Tom Kazansky,LT,Pilot,420,ready_reserve,F-14B,LSO,,\n'
  );
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const onFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const r = new FileReader();
    r.onload = () => setCsv(String(r.result || ''));
    r.readAsText(file);
  };

  const run = async (dry) => {
    setBusy(true);
    try {
      const r = await api.post(`/api/squadrons/${sqn.id}/import-roster${dry ? '?dry=1' : ''}`, { csv });
      setResult(r);
    } finally { setBusy(false); }
  };

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <h3 style={{ marginTop: 0 }}>Import roster</h3>
      <p className="muted small" style={{ marginTop: 0 }}>
        Header row required. Columns (any subset): callsign, name, rank, billet, modex,
        subdivision, airframes, capabilities, discord_user_id, notes.
        Existing pilots are matched by Discord ID (preferred) or callsign+name and
        updated in place — re-uploading is safe.
      </p>
      <div className="row" style={{ marginBottom: 10 }}>
        <input type="file" accept=".csv,text/csv" onChange={onFile} />
      </div>
      <textarea rows={8} value={csv} onChange={(e) => setCsv(e.target.value)} style={{ fontFamily: 'monospace', width: '100%' }} />
      <div className="row" style={{ marginTop: 10, alignItems: 'center' }}>
        <button type="button" className="small" disabled={busy} onClick={() => run(true)}>Dry-run preview</button>
        <button type="button" className="primary" disabled={busy} onClick={() => run(false)}>Import for real</button>
        {result && <button type="button" className="small" onClick={onDone}>Done</button>}
      </div>
      {result && (
        <div className="card" style={{ marginTop: 12 }}>
          <p className="small" style={{ marginTop: 0 }}>
            <b>{result.dry ? 'Preview' : 'Imported'}:</b> {result.created} new, {result.updated} updated,
            {' '}{result.skipped} skipped ({result.total} rows).
          </p>
          {result.preview?.length > 0 && (
            <table>
              <thead><tr><th>Action</th><th>Callsign</th><th>Name</th><th>Modex</th><th>Caps</th></tr></thead>
              <tbody>
                {result.preview.map((p, i) => (
                  <tr key={i}>
                    <td><span className={`badge ${p.action === 'create' ? 'qualified' : 'training'}`}>{p.action}</span></td>
                    <td>{p.callsign || '—'}</td><td className="small">{p.name || '—'}</td>
                    <td className="small muted">{p.modex || '—'}</td>
                    <td className="small">{p.capabilities || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
