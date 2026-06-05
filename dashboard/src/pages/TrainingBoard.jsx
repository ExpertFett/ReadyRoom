import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useMe } from '../App.jsx';

/**
 * Training board — pilots × activities matrix.
 *
 * Phase 4.2 polish:
 *   • Column headers carry rank · callsign · modex · billet · per-pilot
 *     hold status for this qual (EXPIRED / Exp: MM/DD/YY / Current).
 *   • Pilots grouped by subdivision with banner rows (MAIN / FRS / etc.).
 *   • Activities grouped by group_name with banner rows above each group.
 */

const SUBDIV_ORDER = ['main', 'ready_reserve', 'candidate', 'frs'];
const SUBDIV_LABEL = {
  main: 'MAIN',
  ready_reserve: 'READY RESERVE',
  candidate: 'CANDIDATE',
  frs: 'FRS',
};

const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString([], { month: '2-digit', day: '2-digit', year: '2-digit' }) : null);

export default function TrainingBoard() {
  const { qualId } = useParams();
  const { me } = useMe();
  const [board, setBoard] = useState(null);
  const load = async () => setBoard(await api.get(`/api/quals/${qualId}/board`));
  useEffect(() => { load(); }, [qualId]);

  if (!board) return <p className="muted">Loading…</p>;

  const sign = async (memberId, activityId) => {
    await api.post(`/api/members/${memberId}/signoffs/${activityId}`, { status: 'signed' });
    load();
  };
  const unsign = async (memberId, activityId) => {
    await api.del(`/api/members/${memberId}/signoffs/${activityId}`);
    load();
  };
  const deleteAct = async (id) => {
    if (!confirm('Delete this activity? All sign-offs for it will be removed.')) return;
    await api.del(`/api/activities/${id}`);
    load();
  };

  // Group members by subdivision (preserves order within each group via the
  // original sort key of the board response).
  const memberGroups = useMemo(() => {
    const groups = new Map();
    board.members.forEach((m, originalIdx) => {
      const sub = m.subdivision || 'main';
      if (!groups.has(sub)) groups.set(sub, []);
      groups.get(sub).push({ ...m, _idx: originalIdx });
    });
    return SUBDIV_ORDER
      .filter((s) => groups.has(s))
      .concat([...groups.keys()].filter((s) => !SUBDIV_ORDER.includes(s)))
      .map((s) => ({ key: s, label: SUBDIV_LABEL[s] || s.toUpperCase(), members: groups.get(s) }));
  }, [board.members]);

  // Group activities by group_name (null = ungrouped). Banner rows separate
  // groups visually.
  const activityRows = useMemo(() => {
    const rows = [];
    let lastGroup = '__init__';
    board.activities.forEach((a, idx) => {
      const g = a.group_name || null;
      if (g !== lastGroup) {
        if (g) rows.push({ kind: 'banner', label: g });
        lastGroup = g;
      }
      rows.push({ kind: 'activity', activity: a, idx });
    });
    return rows;
  }, [board.activities]);

  // Render members in subdivision order (flatten groups into one ordered list)
  const orderedMembers = memberGroups.flatMap((g) => g.members);

  return (
    <div>
      <div className="crumbs"><Link to="/qualifications">Qualifications</Link> / Board / {board.qual.code}</div>
      <h1>{board.qual.code} <span className="muted small" style={{ fontSize: 16, fontWeight: 400 }}>{board.qual.name}</span></h1>
      <p className="muted small">
        {board.activities.length} activities · {board.members.length} pilots
        {board.qual.currency_days ? ` · ${board.qual.currency_days}-day currency` : ''}
      </p>

      {me.isAdmin && <AddActivity qualId={board.qual.id} onAdded={load} />}

      {!board.activities.length ? (
        <div className="empty">No activities yet. Add some via the Manage tab on Qualifications.</div>
      ) : (
        <div className="card tb-wrap" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="training-board">
            <thead>
              {/* Subdivision banner row */}
              <tr>
                <th className="row-head" rowSpan={2} style={{ verticalAlign: 'bottom' }}>Activity</th>
                {memberGroups.map((g) => (
                  <th key={g.key} colSpan={g.members.length}
                      style={{ background: 'rgba(76,139,245,0.10)', color: 'var(--accent, #4c8bf5)', letterSpacing: 1, fontSize: 11, padding: '4px 6px' }}>
                    {g.label} <span className="muted small">({g.members.length})</span>
                  </th>
                ))}
              </tr>
              {/* Per-pilot detailed header */}
              <tr>
                {orderedMembers.map((m) => (
                  <th key={m.id} className="col-head">
                    {m.rank && <div className="muted small">{m.rank}</div>}
                    <div>{m.callsign || '—'}</div>
                    <div className="muted small">{m.modex || '—'}</div>
                    {m.billet && <div className="muted small" style={{ color: 'var(--accent, #4c8bf5)' }}>{m.billet}</div>}
                    <HoldStatus m={m} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {activityRows.map((row, i) => {
                if (row.kind === 'banner') {
                  return (
                    <tr key={`banner-${i}`}>
                      <td colSpan={orderedMembers.length + 1}
                          style={{ background: 'rgba(138,99,255,0.10)', color: '#a98fff', letterSpacing: 1,
                            fontSize: 11, fontWeight: 700, padding: '4px 12px' }}>
                        ▼ {row.label.toUpperCase()}
                      </td>
                    </tr>
                  );
                }
                const a = row.activity;
                const cellsRow = board.cells[row.idx];
                return (
                  <tr key={a.id}>
                    <td className="row-head">
                      <div>{a.name}
                        {me.isAdmin && <button className="small danger" style={{ padding: '0 6px', marginLeft: 6, fontSize: 11 }} onClick={() => deleteAct(a.id)} title="Delete activity">×</button>}
                      </div>
                    </td>
                    {orderedMembers.map((m) => {
                      const status = cellsRow[m._idx];
                      if (!me.isAdmin) {
                        return <td key={m.id} className={`cell ${status || 'unsigned'}`}>
                          {status === 'instructor' ? 'INSTR' : status === 'signed' ? '✓' : '—'}
                        </td>;
                      }
                      return (
                        <td key={m.id} className={`cell ${status || 'unsigned'}`}>
                          {status
                            ? <button className="cell-btn" title="Click to clear" onClick={() => unsign(m.id, a.id)}>
                                {status === 'instructor' ? 'INSTR' : 'SIGNED'}
                              </button>
                            : <button className="cell-btn empty" title="Click to sign off" onClick={() => sign(m.id, a.id)}>·</button>}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Per-pilot hold-status line in the column header. Color-coded to match the
// Currency dashboard's expectations: green=current, yellow=expiring,
// red=expired.
function HoldStatus({ m }) {
  if (!m.hold_currency) {
    return <div className="muted small" style={{ marginTop: 2 }}>—</div>;
  }
  const { status, days_remaining } = m.hold_currency;
  if (status === 'expired') {
    return <div className="small" style={{ color: '#ff6464', fontWeight: 600, marginTop: 2 }}>EXPIRED</div>;
  }
  if (status === 'expiring') {
    return <div className="small" style={{ color: '#ffcc00', marginTop: 2 }}>Exp: {fmtDate(m.hold_expires_at)}</div>;
  }
  if (m.hold_expires_at) {
    return <div className="small" style={{ color: '#9aa', marginTop: 2 }}>Exp: {fmtDate(m.hold_expires_at)}</div>;
  }
  return <div className="small" style={{ color: '#4cd964', marginTop: 2 }}>Current</div>;
}

function AddActivity({ qualId, onAdded }) {
  const [f, setF] = useState({ name: '', group_name: '', sort_order: '' });
  const submit = async (e) => {
    e.preventDefault();
    if (!f.name.trim()) return;
    await api.post(`/api/quals/${qualId}/activities`, f);
    setF({ name: '', group_name: '', sort_order: '' });
    onAdded();
  };
  return (
    <form className="card" onSubmit={submit} style={{ marginBottom: 14 }}>
      <h3 style={{ marginTop: 0 }}>Add activity</h3>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <div style={{ flex: 1, minWidth: 200 }}><label>Name *</label><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Case 1 Recovery" /></div>
        <div style={{ width: 160 }}><label>Group (optional)</label><input value={f.group_name} onChange={(e) => setF({ ...f, group_name: e.target.value })} placeholder="e.g. IADS · Phase 1" /></div>
        <div style={{ width: 90 }}><label>Order</label><input type="number" value={f.sort_order} onChange={(e) => setF({ ...f, sort_order: e.target.value })} placeholder="1" /></div>
        <button className="small primary">Add</button>
      </div>
    </form>
  );
}
