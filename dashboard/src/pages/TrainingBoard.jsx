import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useMe } from '../App.jsx';

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

  return (
    <div>
      <div className="crumbs"><Link to="/wing">Wing</Link> / Training board / {board.qual.code}</div>
      <h1>{board.qual.code} <span className="muted small" style={{ fontSize: 16, fontWeight: 400 }}>{board.qual.name}</span></h1>
      <p className="muted small">{board.activities.length} activities · {board.members.length} pilots{board.qual.currency_days ? ` · ${board.qual.currency_days}-day currency` : ''}</p>

      {me.isAdmin && <AddActivity qualId={board.qual.id} onAdded={load} />}

      {!board.activities.length ? (
        <div className="empty">No activities yet. Add some from the wing's qual list (admin).</div>
      ) : (
        <div className="card tb-wrap" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="training-board">
            <thead>
              <tr>
                <th className="row-head">Activity</th>
                {board.members.map((m) => (
                  <th key={m.id} className="col-head">
                    <div className="muted small">{m.modex || '—'}</div>
                    <div>{m.callsign}</div>
                    {m.sqn_tag && <div className="muted small">{m.sqn_tag}</div>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {board.activities.map((a, i) => (
                <tr key={a.id}>
                  <td className="row-head">
                    {a.group_name && <div className="muted small">{a.group_name}</div>}
                    <div>{a.name}
                      {me.isAdmin && <button className="small danger" style={{ padding: '0 6px', marginLeft: 6, fontSize: 11 }} onClick={() => deleteAct(a.id)} title="Delete activity">×</button>}
                    </div>
                  </td>
                  {board.members.map((m, j) => {
                    const status = board.cells[i][j];
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
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
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
        <div style={{ width: 160 }}><label>Group (optional)</label><input value={f.group_name} onChange={(e) => setF({ ...f, group_name: e.target.value })} placeholder="e.g. IADS" /></div>
        <div style={{ width: 90 }}><label>Order</label><input type="number" value={f.sort_order} onChange={(e) => setF({ ...f, sort_order: e.target.value })} placeholder="1" /></div>
        <button className="small primary">Add</button>
      </div>
    </form>
  );
}
