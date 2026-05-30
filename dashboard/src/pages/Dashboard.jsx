import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useMe } from '../App.jsx';

const fmt = (ms) => (ms ? new Date(ms).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'TBD');

export default function Dashboard() {
  const { me, activeWing } = useMe();
  const [data, setData] = useState(null);

  useEffect(() => {
    if (activeWing) api.get(`/api/dashboard?wing_id=${activeWing.id}`).then(setData);
  }, [activeWing]);

  if (!activeWing) {
    return (
      <div className="empty">
        No wing set up yet. {me.isAdmin
          ? <Link to="/wing">Set up your wing →</Link>
          : 'Ask an admin to create one.'}
      </div>
    );
  }
  if (!data) return <p className="muted">Loading…</p>;

  return (
    <div>
      <div className="between">
        <div>
          <h1>Welcome back, {me.user.username}</h1>
          <p className="muted">{activeWing.tag ? `${activeWing.tag} — ` : ''}{activeWing.name}</p>
        </div>
      </div>

      <div className="row" style={{ alignItems: 'flex-start', marginTop: 8 }}>
        <section className="card" style={{ flex: '1 1 360px' }}>
          <h3>Upcoming missions</h3>
          {!data.upcoming.length && <div className="empty">No upcoming missions.</div>}
          {data.upcoming.map((m) => (
            <Link key={m.id} to={`/missions/${m.id}`} className="list-row">
              <div>
                <div className="callsign">{m.name}</div>
                <div className="small muted">{fmt(m.start_at)} · {m.primary_aircraft || 'mixed'}</div>
              </div>
              <span className="seat-pill">{m.seats_filled}/{m.seats_total}</span>
            </Link>
          ))}
        </section>

        <section className="card" style={{ flex: '1 1 360px' }}>
          <h3>My signups</h3>
          {!me.member && <p className="muted small">Your Discord isn't linked to a roster member yet, so you can't sign up. An admin can link you on your member page.</p>}
          {me.member && !data.mySignups.length && <div className="empty">You're not signed up for anything.</div>}
          {data.mySignups.map((s) => (
            <Link key={s.signup_id} to={`/missions/${s.mission_id}`} className="list-row">
              <div>
                <div className="callsign">{s.mission_name}</div>
                <div className="small muted">{s.callsign || 'flight'} · {s.role || s.flight_aircraft || ''} · {fmt(s.start_at)}</div>
              </div>
              <span className={`badge ${s.signup_status === 'confirmed' ? 'qualified' : s.signup_status === 'tentative' ? 'training' : 'reserve'}`}>{s.signup_status}</span>
            </Link>
          ))}
        </section>
      </div>

      <section style={{ marginTop: 8 }}>
        <h2>Quick actions</h2>
        <div className="row">
          <Link className="btn" to="/events">Calendar</Link>
          <Link className="btn" to="/missions">All missions</Link>
          {me.isAdmin && <Link className="btn primary" to="/missions?new=1">Create mission</Link>}
          <Link className="btn" to="/metrics">Attendance metrics</Link>
          <Link className="btn" to="/wing">Wing &amp; roster</Link>
        </div>
      </section>

      <LOAPanel wing={activeWing} me={me} />
    </div>
  );
}

function LOAPanel({ wing, me }) {
  const [list, setList] = useState([]);
  const [requesting, setRequesting] = useState(false);
  const load = async () => {
    if (!wing) return;
    setList(await api.get(`/api/wings/${wing.id}/loas`));
  };
  useEffect(() => { load(); }, [wing]);
  const approve = async (id, status) => { await api.put(`/api/loas/${id}`, { status }); load(); };
  const remove = async (id) => { if (confirm('Remove this LOA?')) { await api.del(`/api/loas/${id}`); load(); } };
  return (
    <section style={{ marginTop: 8 }}>
      <div className="between"><h2>Leave of absence</h2>
        {me.member && <button className="small" onClick={() => setRequesting((v) => !v)}>{requesting ? 'Cancel' : 'Request LOA'}</button>}
      </div>
      {requesting && me.member && <LOAForm memberId={me.member.id} onDone={() => { setRequesting(false); load(); }} />}
      {!list.length ? <div className="empty">No upcoming LOAs.</div> : (
        <div className="card">
          {list.map((l) => (
            <div key={l.id} className="between" style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
              <div>
                <strong>{l.callsign}</strong>
                {l.sqn_tag && <span className="muted small"> · {l.sqn_tag}</span>}
                <span className="muted small"> · {fmt(l.start_at)} → {fmt(l.end_at)}</span>
                {l.reason && <div className="small muted">{l.reason}</div>}
              </div>
              <div className="row">
                <span className={`badge ${l.status === 'approved' ? 'active' : l.status === 'denied' ? 'retired' : 'reserve'}`}>{l.status}</span>
                {me.isAdmin && l.status === 'requested' && (
                  <>
                    <button className="small primary" onClick={() => approve(l.id, 'approved')}>Approve</button>
                    <button className="small" onClick={() => approve(l.id, 'denied')}>Deny</button>
                  </>
                )}
                {(me.isAdmin || (me.member && me.member.id === l.member_id)) && (
                  <button className="small danger" onClick={() => remove(l.id)}>×</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function LOAForm({ memberId, onDone }) {
  const [f, setF] = useState({ start_at: '', end_at: '', reason: '' });
  const submit = async (e) => {
    e.preventDefault();
    if (!f.start_at || !f.end_at) return;
    await api.post(`/api/members/${memberId}/loas`, f);
    onDone();
  };
  return (
    <form className="card" onSubmit={submit} style={{ marginBottom: 14 }}>
      <div className="form-grid">
        <div className="field"><label>From</label><input type="date" value={f.start_at} onChange={(e) => setF({ ...f, start_at: e.target.value })} /></div>
        <div className="field"><label>To</label><input type="date" value={f.end_at} onChange={(e) => setF({ ...f, end_at: e.target.value })} /></div>
      </div>
      <div className="field"><label>Reason</label><input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="Training detachment, leave, etc." /></div>
      <button className="primary">Submit request</button>
    </form>
  );
}
