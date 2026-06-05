/**
 * Bulk multi-pilot multi-qual assignment workflow.
 *
 * Left pane:  qual checklist (any number selected).
 * Right pane: pilots — every active member of the wing, filtered by squadron.
 * Bottom CTA: "Assign N qual(s) to M pilot(s)" with mode toggles.
 *
 * Modes:
 *   Assign      — give the qual (status='training' for new rows, idempotent).
 *   Unassign    — strip the qual from every selected pilot.
 *   Instructor  — set status='qualified' AND mark notes='[INSTRUCTOR]' so the
 *                 UI can show that this pilot is instructor-tier on the qual.
 */

import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';

export default function BulkAssign({ wing }) {
  const [quals, setQuals] = useState([]);
  const [members, setMembers] = useState([]);
  const [squadrons, setSquadrons] = useState([]);
  const [pickedQuals, setPickedQuals] = useState(new Set());
  const [pickedMembers, setPickedMembers] = useState(new Set());
  const [sqnFilter, setSqnFilter] = useState('');
  const [mode, setMode] = useState('assign');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    api.get(`/api/quals?wing_id=${wing.id}`).then(setQuals);
    api.get(`/api/squadrons?wing_id=${wing.id}`).then(setSquadrons);
    api.get(`/api/members?wing_id=${wing.id}`).then(setMembers);
  }, [wing.id]);

  // Filtered pilot list — by squadron, only active members.
  const shownPilots = useMemo(() => {
    return members
      .filter((m) => m.status === 'active')
      .filter((m) => !sqnFilter || String(m.squadron_id) === sqnFilter)
      .sort((a, b) => (a.modex || '').localeCompare(b.modex || '') || (a.callsign || '').localeCompare(b.callsign || ''));
  }, [members, sqnFilter]);

  const toggleQual = (id) => {
    const next = new Set(pickedQuals);
    next.has(id) ? next.delete(id) : next.add(id);
    setPickedQuals(next);
  };
  const toggleMember = (id) => {
    const next = new Set(pickedMembers);
    next.has(id) ? next.delete(id) : next.add(id);
    setPickedMembers(next);
  };
  const selectAllQuals = () => setPickedQuals(new Set(quals.map((q) => q.id)));
  const selectAllPilots = () => setPickedMembers(new Set(shownPilots.map((m) => m.id)));
  const clearAll = () => { setPickedQuals(new Set()); setPickedMembers(new Set()); };

  const run = async () => {
    if (!pickedQuals.size || !pickedMembers.size) return;
    const verb = { assign: 'Assign', unassign: 'Unassign', instructor: 'Mark as instructor' }[mode];
    if (!confirm(`${verb} ${pickedQuals.size} qual(s) for ${pickedMembers.size} pilot(s)?`)) return;
    setBusy(true);
    try {
      const r = await api.post(`/api/wings/${wing.id}/quals/bulk-assign`, {
        qual_ids: [...pickedQuals],
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
      <div className="row" style={{ alignItems: 'center', marginBottom: 12, gap: 12 }}>
        <ModeToggle mode={mode} setMode={setMode} />
        <span style={{ flex: 1 }} />
        <select value={sqnFilter} onChange={(e) => setSqnFilter(e.target.value)}>
          <option value="">All squadrons</option>
          {squadrons.map((s) => <option key={s.id} value={s.id}>{s.tag || s.name}</option>)}
        </select>
      </div>

      <div className="row" style={{ alignItems: 'flex-start' }}>
        <section className="card" style={{ flex: '1 1 320px', maxHeight: 480, overflow: 'auto' }}>
          <div className="between">
            <h3 style={{ margin: 0 }}>① Quals <span className="muted small">({pickedQuals.size} selected)</span></h3>
            <button className="small" onClick={selectAllQuals}>Select all</button>
          </div>
          <div style={{ marginTop: 8 }}>
            {!quals.length && <p className="muted small">No quals defined.</p>}
            {quals.map((q) => (
              <label key={q.id} style={{ display: 'flex', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                <input type="checkbox" style={{ width: 'auto' }} checked={pickedQuals.has(q.id)} onChange={() => toggleQual(q.id)} />
                <span><b>{q.code}</b> <span className="muted small">· {q.name}</span></span>
              </label>
            ))}
          </div>
        </section>

        <section className="card" style={{ flex: '1 1 320px', maxHeight: 480, overflow: 'auto' }}>
          <div className="between">
            <h3 style={{ margin: 0 }}>② Pilots <span className="muted small">({pickedMembers.size} selected · {shownPilots.length} eligible)</span></h3>
            <button className="small" onClick={selectAllPilots}>Select all</button>
          </div>
          <div style={{ marginTop: 8 }}>
            {!shownPilots.length && <p className="muted small">No eligible pilots.</p>}
            {shownPilots.map((m) => (
              <label key={m.id} style={{ display: 'flex', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                <input type="checkbox" style={{ width: 'auto' }} checked={pickedMembers.has(m.id)} onChange={() => toggleMember(m.id)} />
                <span>
                  <span className="muted small mono">{m.modex || '—'}</span>{' '}
                  <b>{m.callsign || m.name || `#${m.id}`}</b>
                  {m.rank && <span className="muted small"> · {m.rank}</span>}
                </span>
              </label>
            ))}
          </div>
        </section>
      </div>

      <div className="card" style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
        <button className="small" onClick={clearAll}>Clear selection</button>
        <span className="muted small">
          {modeVerb(mode)} <b>{pickedQuals.size}</b> qual{pickedQuals.size === 1 ? '' : 's'} for{' '}
          <b>{pickedMembers.size}</b> pilot{pickedMembers.size === 1 ? '' : 's'}
        </span>
        <button className={`primary ${mode === 'unassign' ? 'danger' : ''}`}
          disabled={busy || !pickedQuals.size || !pickedMembers.size} onClick={run}>
          {busy ? 'Running…' : modeVerb(mode)}
        </button>
      </div>

      {result && (
        <div className="card" style={{ marginTop: 12 }}>
          {result.error
            ? <p className="error">Failed: {result.error}</p>
            : <p className="muted small">
                ✓ {result.changed} member-qual record{result.changed === 1 ? '' : 's'} {pastTense(result.mode)}.
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
        { k: 'assign',     label: 'Assign' },
        { k: 'unassign',   label: 'Unassign' },
        { k: 'instructor', label: 'Mark Instructor' },
      ].map((m) => (
        <button key={m.k}
          className={`small ${mode === m.k ? 'primary' : ''}`}
          onClick={() => setMode(m.k)}>{m.label}</button>
      ))}
    </div>
  );
}

function modeVerb(m) {
  return { assign: 'Assign', unassign: 'Unassign', instructor: 'Mark Instructor' }[m] || 'Run';
}
function pastTense(m) {
  return { assign: 'assigned', unassign: 'removed', instructor: 'marked instructor' }[m] || 'changed';
}
