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
          <Link className="btn" to="/missions">All missions</Link>
          {me.isAdmin && <Link className="btn primary" to="/missions?new=1">Create mission</Link>}
          <Link className="btn" to="/wing">Wing &amp; roster</Link>
        </div>
      </section>
    </div>
  );
}
