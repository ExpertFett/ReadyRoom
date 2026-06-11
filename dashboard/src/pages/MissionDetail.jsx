import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useMe } from '../App.jsx';

const TYPES = ['standalone', 'campaign', 'library'];
const STATUS = ['planning', 'active', 'completed', 'archived'];
const fmt = (ms) => (ms ? new Date(ms).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'TBD');
const toLocalInput = (ms) => {
  if (!ms) return '';
  const d = new Date(ms - new Date().getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
};

export default function MissionDetail() {
  const { id } = useParams();
  const { me } = useMe();
  const navigate = useNavigate();
  const [m, setM] = useState(null);
  const [squadrons, setSquadrons] = useState([]);
  const [editing, setEditing] = useState(false);

  const load = async () => {
    const mission = await api.get(`/api/missions/${id}`);
    setM(mission);
    setSquadrons(await api.get(`/api/squadrons?wing_id=${mission.wing_id}`));
  };
  useEffect(() => { load(); }, [id]);

  if (!m) return <p className="muted">Loading…</p>;
  const isAdmin = me.isAdmin;

  const del = async () => {
    if (!confirm(`Delete mission "${m.name}"?`)) return;
    await api.del(`/api/missions/${m.id}`);
    navigate('/missions');
  };

  return (
    <div>
      <div className="crumbs"><Link to="/missions">Missions</Link> / {m.name}</div>
      <div className="between">
        <div>
          <h1>{m.name} <span className={`badge ${m.status === 'active' ? 'active' : m.status === 'completed' ? 'qualified' : m.status === 'archived' ? 'retired' : 'reserve'}`}>{m.status}</span></h1>
          <p className="muted">
            {m.type}{m.campaign_name ? ` · ${m.campaign_name}` : ''} · {m.primary_aircraft || 'mixed'} · {fmt(m.start_at)}{m.duration_min ? ` · ${m.duration_min} min` : ''}
          </p>
        </div>
        {isAdmin && (
          <div className="row">
            <button className="small" onClick={() => setEditing((v) => !v)}>{editing ? 'Cancel' : 'Edit'}</button>
            <button className="danger small" onClick={del}>Delete</button>
          </div>
        )}
      </div>

      {editing && <EditMission m={m} onDone={() => { setEditing(false); load(); }} />}
      {m.description && !editing && <div className="card" style={{ whiteSpace: 'pre-wrap' }}>{m.description}</div>}

      <Flights m={m} squadrons={squadrons} me={me} reload={load} />

      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 340px' }}><Access m={m} squadrons={squadrons} isAdmin={isAdmin} reload={load} /></div>
        <div style={{ flex: '1 1 340px' }}><Resources m={m} isAdmin={isAdmin} reload={load} /></div>
      </div>
    </div>
  );
}

function EditMission({ m, onDone }) {
  const [f, setF] = useState({ ...m, start_at: toLocalInput(m.start_at) });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault();
    // f.start_at is a local datetime-local string (from toLocalInput). Convert
    // it back to epoch ms in the user's TZ — sending the raw string would let
    // the UTC server reparse it and shift the time (see Calendar create event).
    await api.put(`/api/missions/${m.id}`, {
      ...f,
      start_at: f.start_at ? new Date(f.start_at).getTime() : null,
    });
    onDone();
  };
  return (
    <form className="card" onSubmit={save}>
      <div className="form-grid">
        <div className="field"><label>Name</label><input value={f.name || ''} onChange={set('name')} /></div>
        <div className="field"><label>Primary aircraft</label><input value={f.primary_aircraft || ''} onChange={set('primary_aircraft')} /></div>
        <div className="field"><label>Type</label><select value={f.type} onChange={set('type')}>{TYPES.map((t) => <option key={t}>{t}</option>)}</select></div>
        <div className="field"><label>Status</label><select value={f.status} onChange={set('status')}>{STATUS.map((s) => <option key={s}>{s}</option>)}</select></div>
        <div className="field"><label>Date &amp; time</label><input type="datetime-local" value={f.start_at} onChange={set('start_at')} /></div>
        <div className="field"><label>Duration (min)</label><input type="number" value={f.duration_min || ''} onChange={set('duration_min')} /></div>
      </div>
      <div className="field"><label>Description</label><textarea rows={3} value={f.description || ''} onChange={set('description')} /></div>
      <button className="primary">Save</button>
    </form>
  );
}

function Flights({ m, squadrons, me, reload }) {
  const [adding, setAdding] = useState(false);
  const fileRef = useRef(null);

  const importMiz = async (file) => {
    const replace = m.flights.length > 0
      ? confirm('Replace existing flights with the .miz contents?\nOK = replace · Cancel = append')
      : false;
    const buf = await file.arrayBuffer();
    const res = await fetch(`/api/missions/${m.id}/import-miz${replace ? '?replace=1' : ''}`, {
      method: 'POST', body: buf, credentials: 'same-origin',
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(`Import failed: ${err.error || res.statusText}`);
      return;
    }
    const data = await res.json();
    alert(`Imported ${data.flights_created} flight(s) from ${data.parsed_slots} client slot(s).`);
    reload();
  };

  return (
    <section>
      <div className="between"><h2>Flights &amp; slots</h2>
        {me.isAdmin && (
          <div className="row">
            <button className="small" onClick={() => fileRef.current?.click()}>Import .miz</button>
            <input
              ref={fileRef} type="file" accept=".miz" style={{ display: 'none' }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) importMiz(f); e.target.value = ''; }}
            />
            <button className="small" onClick={() => setAdding((v) => !v)}>{adding ? 'Cancel' : '+ Flight'}</button>
          </div>
        )}
      </div>
      {adding && <FlightForm missionId={m.id} squadrons={squadrons} defaultAircraft={m.primary_aircraft} onDone={() => { setAdding(false); reload(); }} />}
      {!m.flights.length ? <div className="empty">No flights yet.</div> : (
        <div className="grid">
          {m.flights.map((f) => <FlightCard key={f.id} flight={f} squadrons={squadrons} me={me} reload={reload} />)}
        </div>
      )}
    </section>
  );
}

function FlightCard({ flight, squadrons, me, reload }) {
  const [editing, setEditing] = useState(false);
  const full = flight.filled >= flight.slots;
  const mine = flight.signups.find((s) => me.member && s.member_id === me.member.id);

  const signMe = async () => {
    try { await api.post(`/api/flights/${flight.id}/signup`); reload(); }
    catch (e) { alert(e.message === 'no_member' ? "Your Discord isn't linked to a roster member yet." : e.message === 'flight_full' ? 'Flight is full.' : e.message === 'already_signed' ? "You're already signed up in another flight for this mission." : 'Could not sign up.'); }
  };
  const removeSignup = async (sid) => { await api.del(`/api/signups/${sid}`); reload(); };
  const delFlight = async () => { if (confirm('Delete this flight?')) { await api.del(`/api/flights/${flight.id}`); reload(); } };

  if (editing) return <div className="card"><FlightForm flight={flight} squadrons={squadrons} onDone={() => { setEditing(false); reload(); }} /></div>;

  return (
    <div className="card">
      <div className="between">
        <div><span className="tag" style={{ fontWeight: 700 }}>{flight.callsign || 'Flight'}</span>
          <span className="seat-pill" style={{ marginLeft: 8 }}>{flight.filled}/{flight.slots}</span></div>
        {me.isAdmin && <div className="small"><button className="small" onClick={() => setEditing(true)}>edit</button> <button className="small danger" onClick={delFlight}>×</button></div>}
      </div>
      <div className="small muted">{flight.aircraft || '—'}{flight.role ? ` · ${flight.role}` : ''}</div>
      <div className="chip-row" style={{ margin: '10px 0' }}>
        {flight.signups.map((s) => (
          <span key={s.id} className="chip">{s.callsign || s.name}
            {(me.isAdmin || (me.member && s.member_id === me.member.id)) && <button onClick={() => removeSignup(s.id)} title="Remove">×</button>}</span>
        ))}
        {flight.filled === 0 && <span className="muted small">empty</span>}
      </div>
      {!mine ? (
        <button className="small primary" disabled={full} onClick={signMe}>{full ? 'Full' : 'Sign me up'}</button>
      ) : (
        <button className="small" onClick={() => removeSignup(mine.id)}>Drop slot</button>
      )}
    </div>
  );
}

function FlightForm({ missionId, flight, squadrons, defaultAircraft, onDone }) {
  const [f, setF] = useState(flight || { callsign: '', aircraft: defaultAircraft || '', role: '', slots: 1, squadron_id: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault();
    if (flight) await api.put(`/api/flights/${flight.id}`, f);
    else await api.post(`/api/missions/${missionId}/flights`, f);
    onDone();
  };
  return (
    <form onSubmit={save}>
      <div className="form-grid">
        <div className="field"><label>Callsign</label><input value={f.callsign || ''} onChange={set('callsign')} placeholder="Ghostrider 1" /></div>
        <div className="field"><label>Aircraft</label><input value={f.aircraft || ''} onChange={set('aircraft')} placeholder="F-14B" /></div>
        <div className="field"><label>Role / task</label><input value={f.role || ''} onChange={set('role')} placeholder="CAP" /></div>
        <div className="field"><label>Seats</label><input type="number" min="1" max="20" value={f.slots} onChange={set('slots')} /></div>
        <div className="field"><label>Squadron</label>
          <select value={f.squadron_id || ''} onChange={set('squadron_id')}>
            <option value="">(any)</option>
            {squadrons.map((s) => <option key={s.id} value={s.id}>{s.tag || s.name}</option>)}
          </select></div>
      </div>
      <button className="small primary">{flight ? 'Save flight' : 'Add flight'}</button>
    </form>
  );
}

function Access({ m, squadrons, isAdmin, reload }) {
  const [editing, setEditing] = useState(false);
  const current = new Map(m.squadron_access.map((a) => [a.squadron_id, a.role]));
  const [sel, setSel] = useState(() => new Map(current));

  const save = async () => {
    const access = [...sel.entries()].map(([squadron_id, role]) => ({ squadron_id, role }));
    await api.post(`/api/missions/${m.id}/access`, { access });
    setEditing(false);
    reload();
  };
  const toggle = (id) => {
    const next = new Map(sel);
    if (next.has(id)) next.delete(id); else next.set(id, 'invited');
    setSel(next);
  };
  const setRole = (id, role) => { const next = new Map(sel); next.set(id, role); setSel(next); };

  return (
    <section className="card">
      <div className="between"><h3>Squadron access</h3>
        {isAdmin && <button className="small" onClick={() => { setSel(new Map(current)); setEditing((v) => !v); }}>{editing ? 'Cancel' : 'Edit'}</button>}
      </div>
      {!editing ? (
        <div className="chip-row">
          {!m.squadron_access.length && <span className="muted small">Open to all (no restriction set).</span>}
          {m.squadron_access.map((a) => <span key={a.squadron_id} className="chip">{a.tag || a.name} <span className="muted small">· {a.role}</span></span>)}
        </div>
      ) : (
        <div>
          {squadrons.map((s) => (
            <div key={s.id} className="between" style={{ padding: '4px 0' }}>
              <label style={{ margin: 0 }}><input type="checkbox" style={{ width: 'auto', marginRight: 8 }} checked={sel.has(s.id)} onChange={() => toggle(s.id)} />{s.tag || s.name}</label>
              {sel.has(s.id) && (
                <select style={{ width: 120 }} value={sel.get(s.id)} onChange={(e) => setRole(s.id, e.target.value)}>
                  <option value="invited">invited</option><option value="host">host</option>
                </select>
              )}
            </div>
          ))}
          <button className="small primary" onClick={save} style={{ marginTop: 8 }}>Save access</button>
        </div>
      )}
    </section>
  );
}

function Resources({ m, isAdmin, reload }) {
  const [f, setF] = useState({ kind: 'link', label: '', url: '' });
  const add = async (e) => {
    e.preventDefault();
    if (!f.url && !f.label) return;
    await api.post(`/api/missions/${m.id}/resources`, f);
    setF({ kind: 'link', label: '', url: '' });
    reload();
  };
  const del = async (id) => { await api.del(`/api/resources/${id}`); reload(); };
  return (
    <section className="card">
      <h3>Files &amp; resources</h3>
      {!m.resources.length && <p className="muted small">No resources attached.</p>}
      {m.resources.map((r) => (
        <div key={r.id} className="between" style={{ padding: '4px 0' }}>
          <div><span className="badge" style={{ marginRight: 6 }}>{r.kind}</span>
            {r.url ? <a href={r.url} target="_blank" rel="noreferrer">{r.label || r.url}</a> : (r.label || '—')}</div>
          {isAdmin && <button className="small danger" onClick={() => del(r.id)}>×</button>}
        </div>
      ))}
      {isAdmin && (
        <form onSubmit={add} style={{ marginTop: 10 }}>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <div style={{ width: 120 }}><label>Kind</label>
              <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
                {['briefing', 'kneeboard', 'miz', 'link'].map((k) => <option key={k}>{k}</option>)}
              </select></div>
            <div style={{ flex: 1 }}><label>Label</label><input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="Briefing PDF" /></div>
          </div>
          <div className="field" style={{ marginTop: 8 }}><label>URL</label><input value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://…" /></div>
          <button className="small">Add resource</button>
        </form>
      )}
    </section>
  );
}
