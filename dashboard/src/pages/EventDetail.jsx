import { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useMe } from '../App.jsx';

const STATUSES = [
  { key: 'present', label: 'Present', cls: 'present' },
  { key: 'extra_credit', label: 'Extra Credit', cls: 'extra' },
  { key: 'excused', label: 'Excused', cls: 'excused' },
  { key: 'ua', label: 'UA', cls: 'ua' },
  { key: 'absent', label: 'Absent', cls: 'absent' },
];

const fmt = (ms) => (ms ? new Date(ms).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'TBD');

// Flight sign-up board: groups the event's slots by flight, shows who's in
// each slot, and lets the signed-in member take/leave a slot. Two-way with the
// Ops Bot — taking a slot here updates the Discord panel and vice-versa.
function FlightRoster({ event, me, onChange }) {
  const [busy, setBusy] = useState(false);
  const myId = me.user?.id;
  const signups = event.signups || [];
  const myRoles = new Set(signups.filter((s) => String(s.discord_user_id) === String(myId)).map((s) => s.role_label));

  const flights = [];
  const byGroup = new Map();
  for (const r of event.roles) {
    const g = r.group || 'Slots';
    if (!byGroup.has(g)) { byGroup.set(g, []); flights.push(g); }
    byGroup.get(g).push(r);
  }
  const byRole = new Map();
  for (const s of signups) {
    if (!byRole.has(s.role_label)) byRole.set(s.role_label, []);
    byRole.get(s.role_label).push(s);
  }

  const toggle = async (label) => {
    setBusy(true);
    try { await api.post(`/api/events/${event.id}/signups`, { role_label: label }); onChange(); }
    catch (e) {
      const err = e.data?.error;
      alert(err === 'qual_required' ? `That slot requires the ${e.data.qual} qualification.`
        : err === 'slot_full' ? 'That slot is full.' : 'Sign-up failed.');
    } finally { setBusy(false); }
  };
  const withdraw = async () => { setBusy(true); try { await api.del(`/api/events/${event.id}/signups`); onChange(); } finally { setBusy(false); } };

  return (
    <section style={{ marginBottom: 14 }}>
      <div className="between">
        <h2 style={{ marginBottom: 4 }}>Flights &amp; sign-ups</h2>
        {me.member && myRoles.size > 0 && <button className="small" onClick={withdraw} disabled={busy}>Withdraw from all</button>}
      </div>
      {!me.member && <p className="muted small" style={{ marginTop: 0 }}>Your Discord isn't linked to a roster member yet, so you can't sign up. An admin can link you on your member page.</p>}
      <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {flights.map((flight) => {
          const tasking = event.taskings?.[flight];
          const slots = byGroup.get(flight);
          const filledCount = slots.reduce((n, r) => n + (byRole.get(r.label)?.length || 0), 0);
          const cap = slots.reduce((n, r) => n + (r.limit || 0), 0);
          return (
            <section key={flight} className="card" style={{ flex: '1 1 260px', minWidth: 0 }}>
              <h3 style={{ marginTop: 0 }}>
                {tasking && <span className="badge cap" style={{ marginRight: 6 }}>{tasking}</span>}
                {flight} <span className="muted small">({filledCount}/{cap})</span>
              </h3>
              {slots.map((role) => {
                const filled = byRole.get(role.label) || [];
                const isMine = myRoles.has(role.label);
                const full = role.limit && filled.length >= role.limit && !isMine;
                return (
                  <div key={role.label} className="between" style={{ padding: '5px 0', borderBottom: '1px solid var(--border)', gap: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <strong>{role.label}</strong>{role.qual && <span className="muted small"> 🔒 {role.qual}</span>}
                      <div className="small muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {filled.length ? filled.map((s) => s.callsign || s.display_name || 'pilot').join(', ') : 'open'}
                      </div>
                    </div>
                    {me.member && (
                      <button className={`small ${isMine ? 'primary' : ''}`} disabled={busy || full} onClick={() => toggle(role.label)} style={{ flex: '0 0 auto' }}>
                        {isMine ? 'Leave' : full ? 'Full' : 'Take'}
                      </button>
                    )}
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>
    </section>
  );
}

export default function EventDetail() {
  const { id } = useParams();
  const { me } = useMe();
  const navigate = useNavigate();
  const [event, setEvent] = useState(null);

  const load = async () => setEvent(await api.get(`/api/events/${id}`));
  useEffect(() => { load(); }, [id]);

  if (!event) return <p className="muted">Loading…</p>;

  const mark = async (memberId, status) => {
    await api.post(`/api/events/${event.id}/attendance`, { member_id: memberId, status });
    load();
  };
  const clear = async (memberId) => {
    await api.del(`/api/events/${event.id}/attendance/${memberId}`);
    load();
  };
  const del = async () => {
    if (!confirm(`Delete event "${event.title}"?`)) return;
    await api.del(`/api/events/${event.id}`);
    navigate('/events');
  };

  // Bulk-mark whoever isn't marked yet
  const bulkMarkUnmarked = async (status) => {
    if (!confirm(`Mark all unmarked pilots as ${status}?`)) return;
    for (const m of event.roster) {
      if (!m.attendance) await api.post(`/api/events/${event.id}/attendance`, { member_id: m.id, status });
    }
    load();
  };

  return (
    <div>
      <div className="crumbs"><Link to="/events">Events</Link> / {event.title}</div>
      <div className="between">
        <div>
          <h1>{event.title} {event.kind === 'extra_credit' && <span className="badge commander" style={{ marginLeft: 8 }}>★ Extra Credit</span>}</h1>
          <p className="muted">{fmt(event.start_at)}{event.track_attendance ? ' · attendance tracked' : ''}</p>
        </div>
        {me.isAdmin && <button className="danger small" onClick={del}>Delete</button>}
      </div>

      {event.description && <div className="card" style={{ whiteSpace: 'pre-wrap', marginBottom: 14 }}>{event.description}</div>}

      {event.roles?.length > 0 && <FlightRoster event={event} me={me} onChange={load} />}

      {!event.roster?.length ? (
        <div className="empty">No expected attendees. (Pick a host squadron when creating the event.)</div>
      ) : (
        <>
          {me.isAdmin && (
            <div className="row" style={{ marginBottom: 10 }}>
              <span className="muted small" style={{ alignSelf: 'center' }}>Bulk-mark unmarked:</span>
              {STATUSES.map((s) => <button key={s.key} className="small" onClick={() => bulkMarkUnmarked(s.key)}>{s.label}</button>)}
            </div>
          )}
          <div className="card" style={{ padding: 0 }}>
            <table>
              <thead><tr><th>Modex</th><th>Callsign</th><th>Name</th><th>Squadron</th><th>Status</th>{me.isAdmin && <th></th>}</tr></thead>
              <tbody>
                {event.roster.map((m) => (
                  <tr key={m.id}>
                    <td className="small muted">{m.modex || '—'}</td>
                    <td><Link to={`/members/${m.id}`} className="callsign">{m.callsign || '—'}</Link></td>
                    <td>{m.name || '—'}</td>
                    <td className="small muted">{m.sqn_tag || '—'}</td>
                    <td>
                      {me.isAdmin ? (
                        <select value={m.attendance?.status || ''} onChange={(e) => mark(m.id, e.target.value)} style={{ width: 130 }}>
                          <option value="">—</option>
                          {STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                        </select>
                      ) : (
                        m.attendance ? <span className={`badge att-${m.attendance.status}`}>{STATUSES.find((s) => s.key === m.attendance.status)?.label || m.attendance.status}</span> : <span className="muted">—</span>
                      )}
                    </td>
                    {me.isAdmin && <td>{m.attendance && <button className="small" onClick={() => clear(m.id)}>clear</button>}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
