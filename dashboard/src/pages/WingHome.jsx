import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useMe } from '../App.jsx';

export default function WingHome() {
  const { me, reload } = useMe();
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
  // Any signed-in user with no wing can stand one up and becomes its admin.
  // After creation we reload /api/me so their fresh admin role takes effect.
  if (!wings.length) return <SetupWing onCreated={async () => { await reload(); await loadWings(); }} />;
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
      <Currency wingId={wing.id} />
      {me.isAdmin && <ModexPools wingId={wing.id} />}
      {me.isAdmin && <SortieFeed wingId={wing.id} />}
      {me.isAdmin && <Ingest wingId={wing.id} />}
      {me.isAdmin && <DiscordPublish wing={wing} />}
    </div>
  );
}

function SetupWing({ onCreated }) {
  const [name, setName] = useState('');
  const [tag, setTag] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true); setErr('');
    try { await api.post('/api/wings', { name, tag }); await onCreated(); }
    catch (e2) {
      setErr(e2.data?.error === 'already_in_wing'
        ? 'You already belong to a wing. Leave it before creating another.'
        : 'Could not create the wing. Try again.');
    }
    finally { setBusy(false); }
  };
  return (
    <div className="card" style={{ maxWidth: 440, margin: '40px auto' }}>
      <h2 style={{ marginTop: 0 }}>Set up your wing</h2>
      <p className="muted small">
        The wing is the top of the org. You'll become its admin and can add squadrons,
        qualifications, and members next.
      </p>
      <form onSubmit={submit}>
        <div className="field"><label>Wing name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Carrier Air Wing One" /></div>
        <div className="field"><label>Tag (optional)</label>
          <input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="CVW-1" /></div>
        <button className="primary" disabled={busy}>{busy ? 'Creating…' : 'Create wing'}</button>
        {err && <p className="error" style={{ marginTop: 10 }}>{err}</p>}
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
  const [f, setF] = useState({ code: '', name: '', category: '', is_tier: false, tier_order: '', tier_label: '', currency_days: '' });
  const load = async () => setQuals(await api.get(`/api/quals?wing_id=${wingId}`));
  useEffect(() => { load(); }, [wingId]);
  const add = async (e) => {
    e.preventDefault();
    if (!f.code.trim() || !f.name.trim()) return;
    await api.post('/api/quals', { wing_id: wingId, ...f, tier_order: Number(f.tier_order) || 0 });
    setF({ code: '', name: '', category: '', is_tier: false, tier_order: '', tier_label: '', currency_days: '' });
    load();
  };
  const del = async (id) => { await api.del(`/api/quals/${id}`); load(); };
  return (
    <section>
      <h2>Qualifications</h2>
      <div className="chip-row" style={{ marginBottom: 12 }}>
        {quals.length === 0 && <span className="muted small">No quals defined yet.</span>}
        {quals.map((q) => (
          <span key={q.id} className="chip" title="Open training board">
            <Link to={`/training/${q.id}`}><strong>{q.code}</strong> {q.name}</Link>
            {q.is_tier ? <span className="tier" style={{ marginLeft: 4 }}>tier{q.tier_label ? `→${q.tier_label}` : ''}</span> : null}
            {q.currency_days ? <span className="muted small" style={{ marginLeft: 4 }}>{q.currency_days}d</span> : null}
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
          <div className="row" style={{ alignItems: 'flex-end', marginTop: 8 }}>
            <div style={{ width: 160 }}><label>Currency (days)</label><input type="number" value={f.currency_days} onChange={(e) => setF({ ...f, currency_days: e.target.value })} placeholder="180" /></div>
            <span className="muted small" style={{ flex: 1 }}>Optional — pilot's currency expires N days after qualified.</span>
          </div>
        </form>
      )}
    </section>
  );
}

function Currency({ wingId }) {
  const [list, setList] = useState([]);
  useEffect(() => { api.get(`/api/wings/${wingId}/currency`).then(setList); }, [wingId]);
  const flagged = (list || []).filter((r) => r.status !== 'current');
  if (!flagged.length) return null;
  return (
    <section>
      <div className="between"><h2>Currency</h2><span className="muted small">{flagged.length} expiring / expired</span></div>
      <div className="card">
        {flagged.map((r, i) => (
          <div key={i} className={`cur-row ${r.status}`}>
            <span className="pilot">{r.callsign}{r.modex && <span className="muted small"> ({r.modex})</span>}</span>
            <span className="qual">{r.code} — {r.qual_name}</span>
            <span className="days">{r.status === 'expired' ? `Expired ${Math.abs(r.days_remaining)}d ago` : `${r.days_remaining}d left`}</span>
          </div>
        ))}
      </div>
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

// The canonical hosted Ops Bot URL — prefilled so 99% of users only need to
// paste the outbound token. Self-hosters override the URL field manually.
const CANONICAL_OPS_BOT_URL = 'https://dcsoptbot-production-0c4b.up.railway.app';

function DiscordPublish({ wing }) {
  const [f, setF] = useState({
    ops_bot_url: wing.ops_bot_url || CANONICAL_OPS_BOT_URL,
    ops_bot_token: wing.ops_bot_token || '',
  });
  const [status, setStatus] = useState('');
  const [testing, setTesting] = useState(false);
  const [discordStatus, setDiscordStatus] = useState(null);

  const loadStatus = async () => {
    try { setDiscordStatus(await api.get(`/api/wings/${wing.id}/discord-status`)); }
    catch { /* ignore */ }
  };

  useEffect(() => {
    setF({
      ops_bot_url: wing.ops_bot_url || CANONICAL_OPS_BOT_URL,
      ops_bot_token: wing.ops_bot_token || '',
    });
    loadStatus();
  }, [wing.id]);

  const togglePause = async () => {
    if (!discordStatus) return;
    await api.put(`/api/wings/${wing.id}/discord-paused`, { paused: !discordStatus.paused });
    loadStatus();
  };

  const save = async (e) => {
    e.preventDefault();
    setStatus('Saving…');
    try { await api.put(`/api/wings/${wing.id}/ops-bot`, f); setStatus('Saved ✓'); loadStatus(); }
    catch (err) { setStatus(`Save failed: ${err.message}`); }
  };

  // Hit Ops Bot's /integrations/readyroom/health endpoint with the bearer token.
  // Confirms URL+token reach a real guild AND the events channel is set.
  const test = async () => {
    setTesting(true); setStatus('Testing…');
    try {
      const base = String(f.ops_bot_url || '').replace(/\/+$/, '');
      const res = await fetch(`${base}/integrations/readyroom/health`, {
        method: 'GET',
        headers: { authorization: `Bearer ${f.ops_bot_token}` },
      });
      const body = await res.json().catch(() => null);
      if (res.ok && body?.ok) {
        setStatus(`✓ Connected to "${body.guild.name}" → #${body.channel.name}`);
      } else if (res.status === 401) setStatus('✗ Token rejected. Check the outbound token.');
      else if (res.status === 409 && body?.error === 'no_events_channel_configured') {
        setStatus('✗ Events channel not picked on Ops Bot. Set it under DCS Server → ReadyRoom integration → Inbound.');
      } else setStatus(`✗ ${body?.error || `HTTP ${res.status}`}`);
    } catch (err) {
      setStatus(`✗ Could not reach Ops Bot (${err.message}). Check the URL.`);
    } finally { setTesting(false); }
  };

  const wired = wing.ops_bot_url && wing.ops_bot_token;
  const paused = discordStatus?.paused;
  const stateKind = !wired ? 'reserve' : paused ? 'loa' : 'active';
  const stateLabel = !wired ? 'not configured' : paused ? 'paused' : 'active';
  return (
    <section>
      <h2>Discord publish <span className={`badge ${stateKind}`} style={{ marginLeft: 8, fontSize: 11 }}>{stateLabel}</span></h2>

      {wired && discordStatus && (
        <div className="card" style={{ marginBottom: 10, padding: 12 }}>
          <div className="row" style={{ alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
            <div>
              <div className="muted small">Status</div>
              <div style={{ color: paused ? 'var(--warn, #ffcc00)' : 'var(--accent-2, #4cd964)', fontWeight: 600 }}>
                {paused ? '⏸ Paused' : '● Active'}
              </div>
            </div>
            <div>
              <div className="muted small">Last published</div>
              <div>
                {discordStatus.last_published
                  ? <>{discordStatus.last_published.title} <span className="muted small">({new Date(discordStatus.last_published.updated_at).toLocaleDateString()})</span></>
                  : <span className="muted">nothing posted yet</span>}
              </div>
            </div>
            <span style={{ flex: 1 }} />
            <button type="button" className="small" onClick={togglePause}>
              {paused ? '▶ Resume publishing' : '⏸ Pause publishing'}
            </button>
          </div>
        </div>
      )}

      <form className="card" onSubmit={save}>
        <p className="muted small" style={{ marginTop: 0 }}>
          When you create an event here, drop a Discord embed in your squadron's events channel via Ops Bot.
          Both fields below are <b>filled in from the Ops Bot dashboard</b> →{' '}
          <b>DCS Server → ReadyRoom integration → Inbound</b>. Click <b>Test connection</b> after saving to confirm it's wired.
        </p>
        <div className="field"><label>Ops Bot URL <span className="muted small">(prefilled to the official deploy — change only if self-hosting)</span></label>
          <input value={f.ops_bot_url} onChange={(e) => setF({ ...f, ops_bot_url: e.target.value })}
                 placeholder="https://your-opsbot.up.railway.app" /></div>
        <div className="field"><label>Outbound token <span className="muted small">(get from Ops Bot → Inbound → Reveal · treat like a password)</span></label>
          <input type="password" value={f.ops_bot_token} onChange={(e) => setF({ ...f, ops_bot_token: e.target.value })}
                 placeholder="(paste from Ops Bot)" /></div>
        <div className="row" style={{ alignItems: 'center', gap: 8 }}>
          <button className="small primary">Save</button>
          <button type="button" className="small" disabled={testing || !f.ops_bot_url || !f.ops_bot_token} onClick={test}>Test connection</button>
          {status && <span className="muted small">{status}</span>}
        </div>
      </form>
    </section>
  );
}

// Modex (side number) allocation per subdivision. Defining a range here powers
// the "next available" hint when adding pilots, so admins don't have to track
// which numbers are taken by hand.
const MODEX_SUBDIVISIONS = [
  { key: 'main', label: 'Main' },
  { key: 'ready_reserve', label: 'Ready Reserve' },
  { key: 'frs', label: 'FRS' },
  { key: 'candidate', label: 'Candidate' },
];

function ModexPools({ wingId }) {
  const [pools, setPools] = useState(null);
  const [draft, setDraft] = useState({}); // subdivision -> { range_start, range_end, notes }
  const [avail, setAvail] = useState({}); // subdivision -> { next, count }
  const [status, setStatus] = useState('');

  const load = async () => {
    const list = await api.get(`/api/wings/${wingId}/modex-pools`);
    setPools(list);
    const byKey = {};
    for (const p of list) byKey[p.subdivision] = { range_start: p.range_start, range_end: p.range_end, notes: p.notes || '' };
    setDraft(byKey);
    // Fetch next-available for every defined pool in parallel — one round-trip
    // wall-clock instead of one-per-subdivision in sequence (N+1). Matters on
    // the EU server: 4 pools went from ~4×RTT to 1×RTT. Each has its own
    // try/catch so one failure doesn't drop the rest.
    const a = {};
    await Promise.all(list.map(async (p) => {
      try {
        const r = await api.get(`/api/wings/${wingId}/modex-pools/${p.subdivision}/available`);
        a[p.subdivision] = { next: r.next, count: r.available?.length || 0 };
      } catch { /* ignore */ }
    }));
    setAvail(a);
  };
  useEffect(() => { load(); }, [wingId]);

  const setField = (sub, field, val) =>
    setDraft((d) => ({ ...d, [sub]: { ...(d[sub] || {}), [field]: val } }));

  const save = async (sub) => {
    const d = draft[sub] || {};
    if (d.range_start === '' || d.range_end === '' || d.range_start == null || d.range_end == null) {
      setStatus('Set both a start and end number.');
      return;
    }
    setStatus('Saving…');
    try {
      await api.put(`/api/wings/${wingId}/modex-pools/${sub}`, {
        range_start: Number(d.range_start), range_end: Number(d.range_end), notes: d.notes || null,
      });
      setStatus('Saved ✓');
      load();
    } catch (e) { setStatus(`Save failed: ${e.message}`); }
  };

  const clear = async (sub) => {
    if (!confirm(`Remove the ${sub} modex pool?`)) return;
    await api.del(`/api/wings/${wingId}/modex-pools/${sub}`);
    setStatus('Removed');
    load();
  };

  if (pools === null) return null;

  return (
    <section>
      <h2>Modex pools</h2>
      <div className="card">
        <p className="muted small" style={{ marginTop: 0 }}>
          Allocate side-number ranges per subdivision. When you add a pilot, ReadyRoom
          suggests the next free number in that subdivision's range.
        </p>
        <table>
          <thead>
            <tr><th>Subdivision</th><th>Start</th><th>End</th><th>Notes</th><th>Next free</th><th></th></tr>
          </thead>
          <tbody>
            {MODEX_SUBDIVISIONS.map(({ key, label }) => {
              const d = draft[key] || {};
              const defined = pools.some((p) => p.subdivision === key);
              const a = avail[key];
              return (
                <tr key={key}>
                  <td><b>{label}</b></td>
                  <td><input type="number" style={{ width: 80 }} value={d.range_start ?? ''}
                    onChange={(e) => setField(key, 'range_start', e.target.value)} placeholder="400" /></td>
                  <td><input type="number" style={{ width: 80 }} value={d.range_end ?? ''}
                    onChange={(e) => setField(key, 'range_end', e.target.value)} placeholder="419" /></td>
                  <td><input style={{ width: 160 }} value={d.notes ?? ''}
                    onChange={(e) => setField(key, 'notes', e.target.value)} placeholder="optional" /></td>
                  <td className="small">{a?.next != null ? <b>#{a.next}</b> : '—'}
                    {a?.count != null && <span className="muted"> ({a.count} free)</span>}</td>
                  <td>
                    <div className="row" style={{ gap: 4 }}>
                      <button className="small primary" onClick={() => save(key)}>Save</button>
                      {defined && <button className="small danger" onClick={() => clear(key)}>✕</button>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {status && <p className="muted small" style={{ marginBottom: 0 }}>{status}</p>}
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
