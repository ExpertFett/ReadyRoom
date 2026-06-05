/**
 * Qualification CRUD with classifier flags + completion deadline.
 *
 * Phase 2 brings four new flags to the editor:
 *   - Basic        → auto-assigned to every new pilot on join
 *   - Currency     → has expiration / renews via the Currency Status page
 *   - Wing-wide    → visible across all squadrons (vs. squadron-scoped)
 *   - Completion deadline (days) → N days from assignment to finish
 *
 * Tier flag, tier_order, tier_label, and currency_days carry over from the
 * existing schema and are still editable here.
 */

import { useEffect, useState } from 'react';
import { api } from '../api.js';

const EMPTY = {
  code: '', name: '', description: '', sort_order: 0,
  is_basic: false, is_currency: false, is_wing_wide: true,
  is_tier: false, tier_order: 0, tier_label: '',
  currency_days: '', completion_deadline_days: '',
};

export default function ManageQuals({ wing }) {
  const [quals, setQuals] = useState([]);
  const [editing, setEditing] = useState(null); // null = not editing; {} = new; {id, ...} = update
  const [status, setStatus] = useState('');

  const load = () => api.get(`/api/quals?wing_id=${wing.id}`).then(setQuals);
  useEffect(() => { load(); }, [wing.id]);

  const save = async (e) => {
    e.preventDefault();
    setStatus('Saving…');
    try {
      const payload = {
        ...editing,
        wing_id: wing.id,
        currency_days: editing.currency_days === '' ? null : Number(editing.currency_days),
        completion_deadline_days: editing.completion_deadline_days === '' ? null : Number(editing.completion_deadline_days),
      };
      if (editing.id) await api.put(`/api/quals/${editing.id}`, payload);
      else await api.post('/api/quals', payload);
      setStatus('Saved ✓');
      setEditing(null);
      load();
    } catch (err) { setStatus(`Save failed: ${err.message}`); }
  };

  const remove = async (q) => {
    if (!confirm(`Delete ${q.code}? Any pilots holding this qual will lose it.`)) return;
    await api.del(`/api/quals/${q.id}`);
    load();
  };

  return (
    <div>
      <div className="between">
        <h2 style={{ margin: 0 }}>Manage qualifications</h2>
        <button className="primary" onClick={() => setEditing({ ...EMPTY })}>+ New qualification</button>
      </div>
      {status && <p className="small muted">{status}</p>}

      {editing && (
        <form className="card" onSubmit={save} style={{ marginTop: 12 }}>
          <h3 style={{ marginTop: 0 }}>{editing.id ? `Edit ${editing.code}` : 'New qualification'}</h3>
          <div className="form-grid">
            <div className="field"><label>Code *</label>
              <input value={editing.code} onChange={(e) => setEditing({ ...editing, code: e.target.value })} placeholder="IQT" /></div>
            <div className="field"><label>Name *</label>
              <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="Initial Qualification Training" /></div>
            <div className="field"><label>Display order</label>
              <input type="number" value={editing.sort_order ?? 0} onChange={(e) => setEditing({ ...editing, sort_order: Number(e.target.value) })} /></div>
            <div className="field"><label>Currency (days) <span className="muted small">renewal interval</span></label>
              <input type="number" value={editing.currency_days ?? ''} onChange={(e) => setEditing({ ...editing, currency_days: e.target.value })} placeholder="180" /></div>
            <div className="field"><label>Completion deadline (days) <span className="muted small">from assignment</span></label>
              <input type="number" value={editing.completion_deadline_days ?? ''} onChange={(e) => setEditing({ ...editing, completion_deadline_days: e.target.value })} placeholder="30" /></div>
            <div className="field"><label>Tier label <span className="muted small">when achieved</span></label>
              <input value={editing.tier_label || ''} onChange={(e) => setEditing({ ...editing, tier_label: e.target.value })} placeholder="FMQ" /></div>
          </div>
          <div className="field"><label>Description</label>
            <textarea rows={3} value={editing.description || ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} placeholder="Course syllabus, objectives, expectations…" /></div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
            <Flag label="Basic — auto-assigned to every new pilot on join" k="is_basic"     v={editing} set={setEditing} />
            <Flag label="Currency — has expiration; renews via Currency dashboard" k="is_currency" v={editing} set={setEditing} />
            <Flag label="Wing-wide — visible across all squadrons" k="is_wing_wide" v={editing} set={setEditing} />
            <Flag label="Tier — counts toward readiness tier progression" k="is_tier" v={editing} set={setEditing} />
          </div>
          {editing.is_tier && (
            <div className="field" style={{ marginTop: 8 }}>
              <label>Tier order <span className="muted small">(lower = lower tier, e.g. IQT=1, CQ=2, MCQ=3)</span></label>
              <input type="number" value={editing.tier_order ?? 0} onChange={(e) => setEditing({ ...editing, tier_order: Number(e.target.value) })} />
            </div>
          )}

          <div className="row" style={{ marginTop: 10, gap: 8 }}>
            <button className="primary">{editing.id ? 'Save changes' : 'Create'}</button>
            <button type="button" className="small" onClick={() => setEditing(null)}>Cancel</button>
          </div>
          {editing.id && <CrewTracks qualId={editing.id} />}
        </form>
      )}

      <div className="card" style={{ padding: 0, marginTop: 12 }}>
        {!quals.length ? <div className="empty" style={{ padding: 14 }}>No quals defined yet.</div> : (
          <table>
            <thead><tr>
              <th>Code</th><th>Name</th><th>Flags</th><th>Currency</th><th>Deadline</th><th></th>
            </tr></thead>
            <tbody>
              {quals.map((q) => (
                <tr key={q.id}>
                  <td><b>{q.code}</b></td>
                  <td>{q.name}</td>
                  <td>
                    {q.is_basic    ? <span className="badge cap" style={{ marginRight: 4 }}>Basic</span> : null}
                    {q.is_currency ? <span className="badge cap" style={{ marginRight: 4 }}>Currency</span> : null}
                    {q.is_tier     ? <span className="badge cap" style={{ marginRight: 4 }}>Tier {q.tier_order || ''}</span> : null}
                    {q.is_wing_wide ? null : <span className="badge cap" style={{ marginRight: 4 }}>Sqn-only</span>}
                  </td>
                  <td className="small">{q.currency_days ? `${q.currency_days}d` : '—'}</td>
                  <td className="small">{q.completion_deadline_days ? `${q.completion_deadline_days}d` : '—'}</td>
                  <td>
                    <div className="row" style={{ gap: 4 }}>
                      <button className="small" onClick={() => setEditing({ ...EMPTY, ...q })}>Edit</button>
                      <button className="small danger" onClick={() => remove(q)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// For multi-crew quals — Pilot / RIO / WSO / etc. A qual with zero tracks is
// treated as single-seat throughout the app. Tracks can only be defined on
// already-saved quals (need the qual_id).
function CrewTracks({ qualId }) {
  const [tracks, setTracks] = useState([]);
  const [adding, setAdding] = useState({ code: '', label: '', sort_order: 0 });

  const load = () => api.get(`/api/quals/${qualId}/tracks`).then(setTracks);
  useEffect(() => { load(); }, [qualId]);

  const add = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!adding.code.trim() || !adding.label.trim()) return;
    try {
      await api.post(`/api/quals/${qualId}/tracks`, adding);
      setAdding({ code: '', label: '', sort_order: 0 });
      load();
    } catch (err) {
      alert(`Add track failed: ${err.message}`);
    }
  };
  const remove = async (id) => {
    if (!confirm('Remove this track?')) return;
    await api.del(`/api/qual-tracks/${id}`);
    load();
  };

  return (
    <section style={{ marginTop: 14, padding: 12, border: '1px solid var(--border)', borderRadius: 6, background: 'rgba(255,255,255,0.02)' }}>
      <h4 style={{ margin: '0 0 4px' }}>Crew position tracks</h4>
      <p className="small muted" style={{ marginTop: 0 }}>
        For multi-crew quals (e.g. F-14B with Pilot + RIO). Leave empty for single-seat.
      </p>
      {tracks.length > 0 && (
        <div className="chip-row" style={{ marginBottom: 8 }}>
          {tracks.map((t) => (
            <span key={t.id} className="chip">
              <b>{t.code}</b> · {t.label}
              <button type="button" onClick={() => remove(t.id)} title="Remove" style={{ marginLeft: 4 }}>×</button>
            </span>
          ))}
        </div>
      )}
      <div className="row" style={{ gap: 6, alignItems: 'flex-end' }}>
        <div className="field" style={{ flex: '0 0 100px' }}><label>Code</label>
          <input value={adding.code} onChange={(e) => setAdding({ ...adding, code: e.target.value })} placeholder="rio" /></div>
        <div className="field" style={{ flex: 1 }}><label>Label</label>
          <input value={adding.label} onChange={(e) => setAdding({ ...adding, label: e.target.value })} placeholder="RIO" /></div>
        <button type="button" className="small" onClick={add}>+ Add track</button>
      </div>
    </section>
  );
}

function Flag({ label, k, v, set }) {
  return (
    <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <input type="checkbox" style={{ width: 'auto' }} checked={!!v[k]} onChange={(e) => set({ ...v, [k]: e.target.checked })} />
      {label}
    </label>
  );
}
