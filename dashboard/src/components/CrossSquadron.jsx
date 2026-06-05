/**
 * Cross-Squadron enrollment management.
 *
 * Pick a host squadron, see its current enrollees (pilots from OTHER
 * squadrons who train under this squadron's pipeline), enroll new pilots
 * by callsign search, unenroll with a click.
 *
 * Distinct from member_attachments (detachments — FT/PT cross-attached
 * roster). Cross-squadron is "training enrollment only" and doesn't change
 * the pilot's home squadron.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

export default function CrossSquadron({ wing }) {
  const [squadrons, setSquadrons] = useState([]);
  const [members, setMembers] = useState([]);
  const [hostId, setHostId] = useState('');
  const [enrollees, setEnrollees] = useState([]);
  const [search, setSearch] = useState('');
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    api.get(`/api/squadrons?wing_id=${wing.id}`).then((s) => {
      setSquadrons(s);
      if (s.length && !hostId) setHostId(String(s[0].id));
    });
    api.get(`/api/members?wing_id=${wing.id}`).then(setMembers);
  }, [wing.id]);

  const loadEnrollees = async () => {
    if (!hostId) return;
    setEnrollees(await api.get(`/api/squadrons/${hostId}/enrollees`));
  };
  useEffect(() => { loadEnrollees(); }, [hostId]);

  const candidates = useMemo(() => {
    if (!hostId) return [];
    const enrolledIds = new Set(enrollees.map((e) => e.id));
    return members
      .filter((m) => m.status === 'active')
      .filter((m) => String(m.squadron_id) !== String(hostId))
      .filter((m) => !enrolledIds.has(m.id))
      .filter((m) => {
        if (!search) return true;
        const q = search.toLowerCase();
        return (m.callsign || '').toLowerCase().includes(q)
            || (m.name || '').toLowerCase().includes(q)
            || String(m.modex || '').includes(q);
      })
      .slice(0, 30);
  }, [members, enrollees, hostId, search]);

  const enroll = async (memberId) => {
    setStatus('Enrolling…');
    try {
      await api.post(`/api/squadrons/${hostId}/enroll`, { member_id: memberId, notes: notes || null });
      setStatus('Enrolled ✓');
      setNotes('');
      loadEnrollees();
    } catch (err) { setStatus(`Failed: ${err.message}`); }
  };
  const unenroll = async (memberId) => {
    if (!confirm('Remove this enrollment?')) return;
    await api.del(`/api/squadrons/${hostId}/enroll/${memberId}`);
    loadEnrollees();
  };

  if (!squadrons.length) return <div className="empty">Add squadrons to your wing first.</div>;

  const host = squadrons.find((s) => String(s.id) === String(hostId));

  return (
    <div>
      <p className="muted">
        Enroll pilots from other squadrons under this squadron's training pipeline. Enrollees appear on
        this squadron's training board and can be assigned its quals. Their home squadron doesn't change.
      </p>

      <div className="card" style={{ padding: 10, marginBottom: 12 }}>
        <div className="row" style={{ alignItems: 'center', gap: 12 }}>
          <label>Host squadron
            <select value={hostId} onChange={(e) => setHostId(e.target.value)}>
              {squadrons.map((s) => <option key={s.id} value={s.id}>{s.tag || s.name}</option>)}
            </select>
          </label>
          <span style={{ flex: 1 }} />
          {status && <span className="muted small">{status}</span>}
        </div>
      </div>

      <div className="row" style={{ alignItems: 'flex-start' }}>
        <section className="card" style={{ flex: '1 1 320px' }}>
          <h3 style={{ marginTop: 0 }}>Current enrollees <span className="muted small">({enrollees.length})</span></h3>
          {!enrollees.length ? <div className="muted small">No cross-squadron enrollments yet.</div> : (
            <table>
              <thead><tr><th>Pilot</th><th>Home</th><th>Notes</th><th></th></tr></thead>
              <tbody>
                {enrollees.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <Link to={`/members/${e.id}`} className="callsign">{e.callsign || e.name}</Link>
                      {e.modex && <span className="muted small"> · {e.modex}</span>}
                    </td>
                    <td className="small">{e.home_sqn_tag || e.home_sqn_name || '—'}</td>
                    <td className="small muted">{e.enrollment_notes || ''}</td>
                    <td><button className="small danger" onClick={() => unenroll(e.id)}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="card" style={{ flex: '1 1 320px' }}>
          <h3 style={{ marginTop: 0 }}>Enroll a pilot</h3>
          <p className="muted small" style={{ marginTop: 0 }}>
            Search by callsign, name, or modex. Pilots already in {host?.tag || host?.name || 'this squadron'} or
            already enrolled don't appear.
          </p>
          <div className="field"><label>Search</label>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="callsign / name / modex…" /></div>
          <div className="field"><label>Notes (optional)</label>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Why are they training here?" /></div>
          {candidates.length === 0 ? (
            <div className="muted small">No eligible pilots match.</div>
          ) : (
            <table>
              <thead><tr><th>Pilot</th><th>Home sqn</th><th></th></tr></thead>
              <tbody>
                {candidates.map((m) => (
                  <tr key={m.id}>
                    <td><b>{m.callsign || m.name || `#${m.id}`}</b> {m.modex && <span className="muted small">· {m.modex}</span>}</td>
                    <td className="small muted">{squadrons.find((s) => s.id === m.squadron_id)?.tag || '—'}</td>
                    <td><button className="small primary" onClick={() => enroll(m.id)}>Enroll</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}
