import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useMe } from '../App.jsx';
import SetupCard from '../components/SetupCard.jsx';

const fmt = (ms) => (ms ? new Date(ms).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'TBD');

export default function Dashboard() {
  const { me, activeWing } = useMe();
  const [data, setData] = useState(null);
  const [stats, setStats] = useState(null);

  useEffect(() => {
    if (!activeWing) return;
    api.get(`/api/dashboard?wing_id=${activeWing.id}`).then(setData);
    api.get(`/api/wings/${activeWing.id}/dashboard-stats`).then(setStats).catch(() => setStats(null));
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

      <SetupCard wingId={activeWing.id} isAdmin={me.isAdmin} />

      <KPITiles stats={stats} />

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

// Six "how's the wing today" tiles, color-coded by domain. Tiles render even
// when stats haven't loaded yet (skeleton dashes) so the layout doesn't jump.
function KPITiles({ stats }) {
  const tiles = [
    { label: 'Active Pilots',  value: stats?.active_pilots,        sub: stats?.total_pilots != null ? `of ${stats.total_pilots} total` : null, accent: '#4c8bf5' },
    { label: '90d Attendance', value: pct(stats?.attendance_90d),  sub: stats?.attendance_90d != null ? 'last 90 days' : 'no events yet', accent: scaleAttend(stats?.attendance_90d) },
    { label: 'Flight Hours',   value: stats?.flight_hours_90d,     sub: 'last 90 days · from sortie hook', accent: '#8a63ff' },
    { label: 'Quals Current',  value: stats?.quals_current,        sub: 'qualifications held', accent: '#4cd964' },
    { label: 'Expiring Soon',  value: stats?.quals_expiring_30d,   sub: 'in the next 30 days', accent: stats?.quals_expiring_30d > 0 ? '#ffcc00' : '#666' },
    { label: 'Boarding Rate',  value: pct(stats?.boarding_rate),   sub: stats?.boarding_rate != null ? 'wing average · all-time' : 'no traps logged', accent: scaleBoarding(stats?.boarding_rate) },
  ];
  return (
    <div className="kpi-grid">
      {tiles.map((t) => (
        <div key={t.label} className="kpi-tile" style={{ borderTop: `3px solid ${t.accent}` }}>
          <div className="kpi-value" style={{ color: t.accent }}>{t.value ?? '—'}</div>
          <div className="kpi-label">{t.label}</div>
          {t.sub && <div className="kpi-sub muted">{t.sub}</div>}
        </div>
      ))}
    </div>
  );
}

function pct(v) { return v == null ? null : `${Math.round(v * 100)}%`; }
function scaleAttend(r) {
  if (r == null) return '#666';
  if (r >= 0.75) return '#4cd964';
  if (r >= 0.5) return '#ffcc00';
  return '#ff6464';
}
function scaleBoarding(r) {
  if (r == null) return '#666';
  if (r >= 0.7) return '#4cd964';
  if (r >= 0.5) return '#ffcc00';
  return '#ff6464';
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
