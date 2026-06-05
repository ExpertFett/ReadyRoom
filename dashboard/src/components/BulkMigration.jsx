/**
 * Bulk Migration — wing-wide activity × pilot spreadsheet.
 *
 * Loads every qual's training board for the active wing and stacks them into
 * one big matrix. Useful for setup operations (new CO inheriting a wing,
 * post-class roster migration, etc.) — see everything at once and flip cells
 * inline.
 *
 * Edit Mode toggle exposes the bulk action toolbar:
 *   • click cells to toggle their selection (highlighted)
 *   • apply Sign Off / Mark Instructor / Reset to the selected set
 */

import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';

const SUBDIV_LABEL = {
  main: 'MAIN', ready_reserve: 'READY RESERVE', candidate: 'CANDIDATE', frs: 'FRS',
};

export default function BulkMigration({ wing }) {
  const [boards, setBoards] = useState(null);  // { qual_id: board }
  const [members, setMembers] = useState([]);
  const [editMode, setEditMode] = useState(false);
  const [selected, setSelected] = useState(new Set()); // 'qualId:activityId:memberId'
  const [mode, setMode] = useState('signed');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  const load = async () => {
    const quals = await api.get(`/api/quals?wing_id=${wing.id}`);
    const m = await api.get(`/api/members?wing_id=${wing.id}`);
    setMembers(m.filter((mm) => mm.status === 'active'));
    const fetched = await Promise.all(quals.map((q) => api.get(`/api/quals/${q.id}/board`)));
    const map = {};
    quals.forEach((q, i) => { map[q.id] = fetched[i]; });
    setBoards(map);
  };
  useEffect(() => { load(); }, [wing.id]);

  // Use the first board's member list as the canonical column order; if there
  // are no boards or activities yet, fall back to the wing's active members.
  const columnMembers = useMemo(() => {
    if (!boards) return [];
    const first = Object.values(boards)[0];
    if (first?.members?.length) return first.members;
    return members;
  }, [boards, members]);

  const memberGroups = useMemo(() => {
    const groups = new Map();
    columnMembers.forEach((m, idx) => {
      const k = m.subdivision || 'main';
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push({ ...m, _idx: idx });
    });
    return [...groups.entries()].map(([key, ms]) => ({
      key, label: SUBDIV_LABEL[key] || key.toUpperCase(), members: ms,
    }));
  }, [columnMembers]);

  const orderedMembers = memberGroups.flatMap((g) => g.members);

  if (!boards) return <p className="muted">Loading every qual's training board…</p>;

  const qualIds = Object.keys(boards).map(Number);
  if (!qualIds.length) return <div className="empty">No qualifications defined yet.</div>;

  const cellKey = (qualId, activityId, memberId) => `${qualId}:${activityId}:${memberId}`;
  const toggleCell = (qualId, activityId, memberId) => {
    if (!editMode) return;
    const k = cellKey(qualId, activityId, memberId);
    const next = new Set(selected);
    next.has(k) ? next.delete(k) : next.add(k);
    setSelected(next);
  };

  const clear = () => { setSelected(new Set()); setStatus(''); };

  // Group selected cells by qual so we can fire one bulk-signoff per qual.
  const apply = async () => {
    if (!selected.size) return;
    const verb = { signed: 'Sign off', instructor: 'Mark instructor', reset: 'Reset' }[mode];
    if (!confirm(`${verb} ${selected.size} cell(s)?`)) return;
    setBusy(true); setStatus('Applying…');
    try {
      const byQual = new Map();
      for (const k of selected) {
        const [q, a, m] = k.split(':').map(Number);
        if (!byQual.has(q)) byQual.set(q, { activities: new Set(), members: new Set() });
        byQual.get(q).activities.add(a);
        byQual.get(q).members.add(m);
      }
      let total = 0;
      for (const [qid, sel] of byQual) {
        const r = await api.post(`/api/quals/${qid}/bulk-signoff`, {
          activity_ids: [...sel.activities],
          member_ids: [...sel.members],
          mode,
        });
        total += r.changed || 0;
      }
      setStatus(`✓ ${total} cell(s) updated.`);
      setSelected(new Set());
      load();
    } catch (err) {
      setStatus(`Failed: ${err.message}`);
    } finally { setBusy(false); }
  };

  return (
    <div>
      <div className="row" style={{ alignItems: 'center', marginBottom: 10, gap: 8 }}>
        <button className={`small ${editMode ? 'primary' : ''}`} onClick={() => { setEditMode((v) => !v); clear(); }}>
          {editMode ? 'Exit edit mode' : 'Edit assignments'}
        </button>
        {editMode && (
          <>
            <span className="muted small">Mode:</span>
            {[
              { k: 'signed', label: 'Sign Off' },
              { k: 'instructor', label: 'Mark Instructor' },
              { k: 'reset', label: 'Reset' },
            ].map((m) => (
              <button key={m.k}
                className={`small ${mode === m.k ? 'primary' : ''}`}
                onClick={() => setMode(m.k)}>{m.label}</button>
            ))}
            <span style={{ flex: 1 }} />
            <span className="muted small">{selected.size} selected</span>
            {selected.size > 0 && <button className="small" onClick={clear}>Clear</button>}
            <button className={`small ${mode === 'reset' ? 'danger' : 'primary'}`}
              disabled={busy || !selected.size} onClick={apply}>Apply</button>
          </>
        )}
        <span style={{ flex: 1 }} />
        {status && <span className="muted small">{status}</span>}
      </div>

      <div className="card tb-wrap" style={{ padding: 0, overflowX: 'auto' }}>
        <table className="training-board">
          <thead>
            <tr>
              <th className="row-head" rowSpan={2} style={{ verticalAlign: 'bottom' }}>Qual / Activity</th>
              {memberGroups.map((g) => (
                <th key={g.key} colSpan={g.members.length}
                    style={{ background: 'rgba(76,139,245,0.10)', color: 'var(--accent, #4c8bf5)', letterSpacing: 1, fontSize: 11 }}>
                  {g.label} <span className="muted small">({g.members.length})</span>
                </th>
              ))}
            </tr>
            <tr>
              {orderedMembers.map((m) => (
                <th key={m.id} className="col-head">
                  <div className="muted small">{m.modex || '—'}</div>
                  <div>{m.callsign || '—'}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {qualIds.map((qid) => {
              const board = boards[qid];
              if (!board.activities.length) return null;
              return (
                <RowsForQual key={qid}
                  board={board} qualId={qid} orderedMembers={orderedMembers}
                  editMode={editMode} selected={selected} toggleCell={toggleCell} />
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RowsForQual({ board, qualId, orderedMembers, editMode, selected, toggleCell }) {
  // Map original member indices in board.members to their position in the
  // orderedMembers list (since the board may have a different order).
  const idxByMemberId = new Map(board.members.map((m, i) => [m.id, i]));
  let lastGroup = '__init__';
  const rows = [];
  // Qual banner row
  rows.push(
    <tr key={`q-${qualId}`}>
      <td colSpan={orderedMembers.length + 1}
          style={{ background: 'rgba(76,139,245,0.18)', color: 'var(--accent, #4c8bf5)',
            letterSpacing: 1, fontSize: 12, fontWeight: 700, padding: '6px 12px' }}>
        ◆ {board.qual.code} <span className="muted">· {board.qual.name}</span>
      </td>
    </tr>
  );
  board.activities.forEach((a, ai) => {
    const g = a.group_name || null;
    if (g !== lastGroup) {
      if (g) rows.push(
        <tr key={`q-${qualId}-g-${ai}`}>
          <td colSpan={orderedMembers.length + 1}
              style={{ background: 'rgba(138,99,255,0.08)', color: '#a98fff', fontSize: 10, padding: '3px 24px' }}>
            ▼ {g.toUpperCase()}
          </td>
        </tr>
      );
      lastGroup = g;
    }
    rows.push(
      <tr key={`q-${qualId}-a-${a.id}`}>
        <td className="row-head" style={{ paddingLeft: 18 }}>{a.name}</td>
        {orderedMembers.map((m) => {
          const cellIdx = idxByMemberId.get(m.id);
          const status = cellIdx != null ? board.cells[ai][cellIdx] : null;
          const k = `${qualId}:${a.id}:${m.id}`;
          const isSel = selected.has(k);
          return (
            <td key={m.id} className={`cell ${status || 'unsigned'}`}
                onClick={() => toggleCell(qualId, a.id, m.id)}
                style={{
                  cursor: editMode ? 'pointer' : 'default',
                  outline: isSel ? '2px solid #ffcc00' : undefined,
                  outlineOffset: isSel ? '-2px' : undefined,
                }}>
              {status === 'instructor' ? 'INSTR' : status === 'signed' ? '✓' : '—'}
            </td>
          );
        })}
      </tr>
    );
  });
  return rows;
}
