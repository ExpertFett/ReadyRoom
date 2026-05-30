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
