/**
 * Bulk activity sign-off — the instructor's post-event workflow.
 *
 * Workflow:
 *   1. Pick a qualification.
 *   2. Pick activities (any subset of that qual's activity list).
 *   3. Pick pilots (active members of the wing, filterable by squadron).
 *   4. Choose mode: Sign Off, Mark Instructor, or Reset.
 *   5. Hit the action button.
 *
 * Auto-qualify rolls forward: once every activity is signed for a pilot, the
 * backend upserts a 'qualified' member_qual row (existing tryAutoQualify path).
 */

import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';

export default function BulkSignoff({ wing }) {
  const [quals, setQuals] = useState([]);
  const [members, setMembers] = useState([]);
  const [squadrons, setSquadrons] = useState([]);
  const [qualId, setQualId] = useState('');
  const [activities, setActivities] = useState([]);
  const [pickedActivities, setPickedActivities] = useState(new Set());
  const [pickedMembers, setPickedMembers] = useState(new Set());
  const [sqnFilter, setSqnFilter] = useState('');
  const [mode, setMode] = useState('signed');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    api.get(`/api/quals?wing_id=${wing.id}`).then(setQuals);
    api.get(`/api/squadrons?wing_id=${wing.id}`).then(setSquadrons);
    api.get(`/api/members?wing_id=${wing.id}`).then(setMembers);
  }, [wing.id]);

  useEffect(() => {
    if (!qualId) { setActivities([]); setPickedActivities(new Set()); return; }
    api.get(`/api/quals/${qualId}/activities`).then((a) => {
      setActivities(a);
      setPickedActivities(new Set());
    });
  }, [qualId]);

  const shownPilots = useMemo(() => {
    return members
      .filter((m) => m.status === 'active')
      .filter((m) => !sqnFilter || String(m.squadron_id) === sqnFilter)
      .sort((a, b) => (a.modex || '').localeCompare(b.modex || '') || (a.callsign || '').localeCompare(b.callsign || ''));
  }, [members, sqnFilter]);

  const toggleAct = (id) => { const n = new Set(pickedActivities); n.has(id) ? n.delete(id) : n.add(id); setPickedActivities(n); };
  const toggleMember = (id) => { const n = new Set(pickedMembers); n.has(id) ? n.delete(id) : n.add(id); setPickedMembers(n); };
  const selectAllActs = () => setPickedActivities(new Set(activities.map((a) => a.id)));
  const selectAllPilots = () => setPickedMembers(new Set(shownPilots.map((m) => m.id)));

  const run = async () => {
    if (!qualId || !pickedActivities.size || !pickedMembers.size) return;
    const verb = { signed: 'Sign off', instructor: 'Mark instructor', reset: 'Reset' }[mode];
    if (!confirm(`${verb} ${pickedActivities.size} activity-row(s) for ${pickedMembers.size} pilot(s)?`)) return;
    setBusy(true);
    try {
      const r = await api.post(`/api/quals/${qualId}/bulk-signoff`, {
        activity_ids: [...pickedActivities],
        member_ids: [...pickedMembers],
        mode,
      });
      setResult(r);
    } catch (err) {
      setResult({ error: err.message });
    } finally { setBusy(false); }
  };

  return (
    <div>
      <div className="card" style={{ padding: 10, marginBottom: 12 }}>
        <div className="row" style={{ alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <label>Qualification
            <select value={qualId} onChange={(e) => setQualId(e.target.value)}>
              <option value="">— pick one —</option>
              {quals.map((q) => <option key={q.id} value={q.id}>{q.code} · {q.name}</option>)}
            </select>
          </label>
          <span style={{ flex: 1 }} />
          <ModeToggle mode={mode} setMode={setMode} />
        </div>
      </div>

      {!qualId ? <div className="empty">Pick a qualification above to load its activities.</div> : (
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <section className="card" style={{ flex: '1 1 320px', maxHeight: 480, overflow: 'auto' }}>
            <div className="between">
              <h3 style={{ margin: 0 }}>① Activities <span className="muted small">({pickedActivities.size} of {activities.length})</span></h3>
              <button className="small" onClick={selectAllActs}>Select all</button>
            </div>
            <div style={{ marginTop: 8 }}>
              {!activities.length && <p className="muted small">This qual has no activities.</p>}
              {activities.map((a) => (
                <label key={a.id} style={{ display: 'flex', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                  <input type="checkbox" style={{ width: 'auto' }} checked={pickedActivities.has(a.id)} onChange={() => toggleAct(a.id)} />
                  <span>{a.name}{a.is_currency ? <span className="muted small"> · currency</span> : null}</span>
                </label>
              ))}
            </div>
          </section>

          <section className="card" style={{ flex: '1 1 320px', maxHeight: 480, overflow: 'auto' }}>
            <div className="between">
              <h3 style={{ margin: 0 }}>② Pilots <span className="muted small">({pickedMembers.size} of {shownPilots.length})</span></h3>
              <div className="row" style={{ gap: 4 }}>
                <select value={sqnFilter} onChange={(e) => setSqnFilter(e.target.value)} style={{ marginRight: 4 }}>
                  <option value="">All squadrons</option>
                  {squadrons.map((s) => <option key={s.id} value={s.id}>{s.tag || s.name}</option>)}
                </select>
                <button className="small" onClick={selectAllPilots}>Select all</button>
              </div>
            </div>
            <div style={{ marginTop: 8 }}>
              {!shownPilots.length && <p className="muted small">No eligible pilots.</p>}
              {shownPilots.map((m) => (
                <label key={m.id} style={{ display: 'flex', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                  <input type="checkbox" style={{ width: 'auto' }} checked={pickedMembers.has(m.id)} onChange={() => toggleMember(m.id)} />
                  <span>
                    <span className="muted small mono">{m.modex || '—'}</span>{' '}
                    <b>{m.callsign || m.name || `#${m.id}`}</b>
                  </span>
                </label>
              ))}
            </div>
          </section>
        </div>
      )}

      {qualId && (
        <div className="card" style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
          <span className="muted small">
            {modeVerb(mode)} <b>{pickedActivities.size}</b> activit{pickedActivities.size === 1 ? 'y' : 'ies'} ×{' '}
            <b>{pickedMembers.size}</b> pilot{pickedMembers.size === 1 ? '' : 's'}
            = <b>{pickedActivities.size * pickedMembers.size}</b> cells
          </span>
          <button className={`primary ${mode === 'reset' ? 'danger' : ''}`}
            disabled={busy || !pickedActivities.size || !pickedMembers.size}
            onClick={run}>{busy ? 'Running…' : modeVerb(mode)}</button>
        </div>
      )}

      {result && (
        <div className="card" style={{ marginTop: 12 }}>
          {result.error
            ? <p className="error">Failed: {result.error}</p>
            : <p className="muted small">
                ✓ {result.changed} cell{result.changed === 1 ? '' : 's'} {pastTense(result.mode)}.
                Auto-qualify ran for the touched pilots.
              </p>}
        </div>
      )}
    </div>
  );
}

function ModeToggle({ mode, setMode }) {
  return (
    <div className="row" style={{ gap: 4 }}>
      {[
        { k: 'signed',     label: 'Sign Off' },
        { k: 'instructor', label: 'Mark Instructor' },
        { k: 'reset',      label: 'Reset' },
      ].map((m) => (
        <button key={m.k}
          className={`small ${mode === m.k ? 'primary' : ''}`}
          onClick={() => setMode(m.k)}>{m.label}</button>
      ))}
    </div>
  );
}

function modeVerb(m) {
  return { signed: 'Sign off', instructor: 'Mark instructor', reset: 'Reset' }[m] || 'Run';
}
function pastTense(m) {
  return { signed: 'signed off', instructor: 'marked instructor', reset: 'cleared' }[m] || 'changed';
}
