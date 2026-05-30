import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useMe } from '../App.jsx';

export default function WingHome() {
  const { me } = useMe();
  const [wings, setWings] = useState(null);
  const [wing, setWing] = useState(null);

  const loadWings = async () => {
    const list = await api.get('/api/wings');
    setWings(list);
    if (list.length) setWing(await api.get(`/api/wings/${list[0].id}`));
    else setWing(null);
  };
  useEffect(() => { loadWings(); }, []);

  if (wings === null) return <p className="muted">Loading…</p>;
  if (!wings.length) return <SetupWing isAdmin={me.isAdmin} onCreated={loadWings} />;
  if (!wing) return <p className="muted">Loading…</p>;

  return (
    <div>
      <div className="between">
        <div>
          <h1>{wing.tag ? `${wing.tag} — ` : ''}{wing.name}</h1>
          {wing.description && <p className="muted">{wing.description}</p>}
        </div>
      </div>

      <Squadrons wing={wing} isAdmin={me.isAdmin} reload={loadWings} />
      <Quals wingId={wing.id} isAdmin={me.isAdmin} />
      {me.isAdmin && <SortieFeed wingId={wing.id} />}
      {me.isAdmin && <Ingest wingId={wing.id} />}
    </div>
  );
}

function SetupWing({ isAdmin, onCreated }) {
  const [name, setName] = useState('');
  const [tag, setTag] = useState('');
  const [busy, setBusy] = useState(false);
  if (!isAdmin) return <div className="empty">No wing has been set up yet. Ask an admin to create one.</div>;
  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try { await api.post('/api/wings', { name, tag }); onCreated(); }
    finally { setBusy(false); }
  };
  return (
    <div className="card" style={{ maxWidth: 440, margin: '40px auto' }}>
      <h2 style={{ marginTop: 0 }}>Set up your wing</h2>
      <p className="muted small">The wing is the top of the org. You'll add squadrons and members next.</p>
      <form onSubmit={submit}>
        <div className="field"><label>Wing name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Carrier Air Wing One" /></div>
        <div className="field"><label>Tag (optional)</label>
          <input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="CVW-1" /></div>
        <button className="primary" disabled={busy}>Create wing</button>
      </form>
    </div>
  );
}

function Squadrons({ wing, isAdmin, reload }) {
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ name: '', tag: '', aircraft: '', kind: 'squadron' });
  const add = async (e) => {
    e.preventDefault();
    if (!f.name.trim()) return;
    await api.post('/api/squadrons', { wing_id: wing.id, ...f });
    setF({ name: '', tag: '', aircraft: '', kind: 'squadron' });
    setAdding(false);
    reload();
  };
  return (
    <section>
      <div className="between"><h2>Squadrons</h2>
        {isAdmin && <button className="small" onClick={() => setAdding((v) => !v)}>{adding ? 'Cancel' : '+ Squadron'}</button>}
      </div>
      {adding && (
        <form className="card" onSubmit={add} style={{ marginBottom: 14 }}>
          <div className="form-grid">
            <div className="field"><label>Name</label><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Wolfpack" /></div>
            <div className="field"><label>Tag</label><input value={f.tag} onChange={(e) => setF({ ...f, tag: e.target.value })} placeholder="VF-1" /></div>
          </div>
          <div className="field"><label>Primary aircraft</label><input value={f.aircraft} onChange={(e) => setF({ ...f, aircraft: e.target.value })} placeholder="F-14B Tomcat" /></div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 12px' }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={f.kind === 'detachment'} onChange={(e) => setF({ ...f, kind: e.target.checked ? 'detachment' : 'squadron' })} />
            This is a detachment (cross-attached pilots, e.g. a C-130 det)
          </label>
          <button className="primary">Add {f.kind === 'detachment' ? 'detachment' : 'squadron'}</button>
        </form>
      )}
      {!wing.squadrons.length ? (
        <div className="empty">No squadrons yet.</div>
      ) : (
        <div className="grid">
          {wing.squadrons.map((s) => (
            <Link key={s.id} to={`/squadrons/${s.id}`} className="card sqn-card">
              <div className="tag">{s.tag || s.name}</div>
              <div>{s.tag ? s.name : ''}</div>
              {s.aircraft && <div className="small muted">{s.aircraft}</div>}
              <div className="count">{s.member_count} {s.member_count === 1 ? 'member' : 'members'}</div>
              {s.kind === 'detachment' && <div className="det-flag">DETACHMENT</div>}
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function Quals({ wingId, isAdmin }) {
  const [quals, setQuals] = useState([]);
  const [f, setF] = useState({ code: '', name: '', category: '', is_tier: false, tier_order: '', tier_label: '' });
  const load = async () => setQuals(await api.get(`/api/quals?wing_id=${wingId}`));
  useEffect(() => { load(); }, [wingId]);
  const add = async (e) => {
    e.preventDefault();
    if (!f.code.trim() || !f.name.trim()) return;
    await api.post('/api/quals', { wing_id: wingId, ...f, tier_order: Number(f.tier_order) || 0 });
    setF({ code: '', name: '', category: '', is_tier: false, tier_order: '', tier_label: '' });
    load();
  };
  const del = async (id) => { await api.del(`/api/quals/${id}`); load(); };
  return (
    <section>
      <h2>Qualifications</h2>
      <div className="chip-row" style={{ marginBottom: 12 }}>
        {quals.length === 0 && <span className="muted small">No quals defined yet.</span>}
        {quals.map((q) => (
          <span key={q.id} className="chip" title={q.name}>
            <strong>{q.code}</strong> {q.name}
            {q.is_tier ? <span className="tier" style={{ marginLeft: 4 }}>tier{q.tier_label ? `→${q.tier_label}` : ''}</span> : null}
            {isAdmin && <button onClick={() => del(q.id)} title="Remove">×</button>}
          </span>
        ))}
      </div>
      {isAdmin && (
        <form onSubmit={add}>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <div style={{ width: 110 }}><label>Code</label><input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="CQ" /></div>
            <div style={{ flex: 1, minWidth: 160 }}><label>Name</label><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Carrier Qualified" /></div>
            <div style={{ width: 140 }}><label>Category</label><input value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} placeholder="Carrier" /></div>
            <button className="small">Add</button>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={f.is_tier} onChange={(e) => setF({ ...f, is_tier: e.target.checked })} />
            Readiness-tier qual (counts toward a pilot's tier)
          </label>
          {f.is_tier && (
            <div className="row" style={{ alignItems: 'flex-end', marginTop: 8 }}>
              <div style={{ width: 130 }}><label>Tier order</label><input type="number" value={f.tier_order} onChange={(e) => setF({ ...f, tier_order: e.target.value })} placeholder="1" /></div>
              <div style={{ width: 190 }}><label>Tier label granted</label><input value={f.tier_label} onChange={(e) => setF({ ...f, tier_label: e.target.value })} placeholder="e.g. FMQ" /></div>
              <span className="muted small" style={{ flex: 1 }}>Lower order = earlier; the highest tier qual a pilot holds sets their tier.</span>
            </div>
          )}
        </form>
      )}
    </section>
  );
}

function SortieFeed({ wingId }) {
  const [sorties, setSorties] = useState([]);
  useEffect(() => { api.get(`/api/sorties?wing_id=${wingId}&limit=15`).then(setSorties); }, [wingId]);
  if (!sorties.length) return null;
  return (
    <section>
      <h2>Recent sorties</h2>
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead><tr><th>Pilot (in-game)</th><th>Airframe</th><th>Duration</th><th>Matched</th></tr></thead>
          <tbody>
            {sorties.map((s) => (
              <tr key={s.id}>
                <td>{s.alias}</td>
                <td>{s.airframe || '—'}</td>
                <td>{Math.round((s.seconds || 0) / 60)} min</td>
                <td>{s.member_id ? '✓' : <span className="muted">unmatched</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Ingest({ wingId }) {
  const [url, setUrl] = useState(null);
  const reveal = async () => setUrl((await api.get(`/api/wings/${wingId}/ingest`)).ingest_url);
  return (
    <section>
      <h2>Sortie ingest</h2>
      <div className="card">
        <p className="muted small" style={{ marginTop: 0 }}>
          POST sortie batches here from the DCS hook (or a VectorBot mirror). Keep this token secret.
        </p>
        {url
          ? <code style={{ wordBreak: 'break-all' }}>{url}</code>
          : <button className="small" onClick={reveal}>Reveal ingest URL</button>}
      </div>
    </section>
  );
}
