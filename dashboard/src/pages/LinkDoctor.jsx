import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useMe } from '../App.jsx';

// Root-only diagnostic + fix for the "roster in one wing, missions/events in
// another" split that 403s pilots on event pages. Shows every wing with its
// member/mission/event counts and each pilot's Discord-link status, and lets a
// root admin move a mis-placed pilot into the wing that actually owns the
// missions/events. See the /api/admin/link-report + /admin/move-member endpoints.
export default function LinkDoctor() {
  const { me } = useMe();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(0);

  const load = async () => {
    try { setErr(null); setData(await api.get('/api/admin/link-report')); }
    catch (e) { setErr(e); }
  };
  useEffect(() => { load(); }, []);

  if (!me.root) return <div className="empty" style={{ marginTop: 40 }}>Link Doctor is for the platform owner only.</div>;
  if (err) return <div className="empty">Couldn't load the report{err.status ? ` (${err.status})` : ''}. <button className="small" onClick={load}>Retry</button></div>;
  if (!data) return <p className="muted">Loading…</p>;

  const wings = data.wings || [];
  // Heuristic: the wing that owns the ops post is where pilots must live.
  const realWing = [...wings].sort((a, b) =>
    (b.opsBotWired - a.opsBotWired) || ((b.missions + b.events) - (a.missions + a.events)) || (b.members - a.members)
  )[0];
  // Pilots sitting in a wing other than the "real" one — the mis-placed ones.
  const strays = wings.filter((w) => realWing && w.id !== realWing.id).reduce((n, w) => n + w.members.length, 0);

  const move = async (memberId, targetWingId, targetSquadronId) => {
    setBusy(memberId);
    try {
      await api.post('/api/admin/move-member', {
        member_id: memberId, target_wing_id: targetWingId,
        target_squadron_id: targetSquadronId || null,
      });
      await load();
    } catch (e) {
      alert(`Move failed${e.status ? ` (${e.status})` : ''}.`);
    } finally { setBusy(0); }
  };

  const doDelete = async (w, force) => {
    setBusy(`w${w.id}`);
    try {
      await api.post('/api/admin/delete-wing', { wing_id: w.id, force });
      await load();
    } catch (e) {
      if (e.data?.error === 'has_linked_pilots') {
        setBusy(0);
        // Owner override: the guard is a safety net, not a wall. Confirm hard.
        if (confirm(`⚠️ “${w.tag || w.name}” still has ${e.data.count} REAL linked pilot${e.data.count === 1 ? '' : 's'}. Deleting removes their linked accounts too.\n\nSafer: cancel and MOVE them to another wing first.\n\nDelete anyway?`)) {
          return doDelete(w, true);
        }
        return;
      }
      alert(`Delete failed${e.status ? ` (${e.status})` : ''}.`);
    } finally { setBusy(0); }
  };
  const del = (w) => {
    if (!confirm(`Delete wing “${w.tag || w.name}” (#${w.id})?\n\nPermanently removes the wing and everything in it (squadrons, missions, events, sorties). Cannot be undone.`)) return;
    doDelete(w, false);
  };

  const delMember = async (m) => {
    if (!confirm(`Remove ${m.callsign || m.name || 'this member'} from the roster?\n\nDeletes this roster entry${m.linked ? ' and unlinks their Discord account' : ''}. Cannot be undone.`)) return;
    setBusy(`m${m.id}`);
    try {
      await api.post('/api/admin/delete-member', { member_id: m.id });
      await load();
    } catch (e) {
      alert(`Remove failed${e.status ? ` (${e.status})` : ''}.`);
    } finally { setBusy(0); }
  };

  return (
    <div>
      <h1>Link Doctor</h1>
      <p className="muted">Every wing, its content, and where each pilot's Discord account is linked. A pilot can only see missions/events in the wing their account belongs to.</p>

      {wings.length > 1 && realWing && strays > 0 && (
        <div className="card" role="alert" style={{ borderColor: 'var(--warn, #f0b429)', marginBottom: 14 }}>
          <b>Split detected.</b> The wing that owns your missions/events is <b>{realWing.tag || realWing.name}</b> (#{realWing.id}).
          {' '}<b>{strays}</b> pilot{strays === 1 ? ' is' : 's are'} linked in <i>other</i> wing{wings.length > 2 ? 's' : ''} and will 403 on event pages.
          Move them into <b>{realWing.tag || realWing.name}</b> with the buttons below, then delete the empty leftover wing(s).
        </div>
      )}

      {wings.map((w) => {
        const isReal = realWing && w.id === realWing.id;
        const linked = w.members.filter((m) => m.linked).length;
        const targets = wings.filter((t) => t.id !== w.id);
        return (
          <section key={w.id} className="card" style={{ marginBottom: 14, ...(isReal ? { borderColor: 'var(--accent, #4c8bf5)' } : {}) }}>
            <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
              <h2 style={{ margin: 0 }}>
                {w.name}{w.tag && w.tag !== w.name ? <span className="muted small"> ({w.tag})</span> : null} <span className="muted small">wing #{w.id}</span>
                {isReal && <span className="badge active" style={{ marginLeft: 8 }}>owns the ops post</span>}
                {w.opsBotWired && <span className="badge cap" style={{ marginLeft: 6 }}>Ops Bot wired</span>}
              </h2>
              <div className="small muted" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span>{w.members.length} member{w.members.length === 1 ? '' : 's'} · {linked} linked · {w.missions} mission{w.missions === 1 ? '' : 's'} · {w.events} event{w.events === 1 ? '' : 's'}</span>
                <button className="small" style={{ color: 'var(--danger, #c0392b)', borderColor: 'var(--danger, #c0392b)' }} disabled={busy === `w${w.id}`} onClick={() => del(w)}>{busy === `w${w.id}` ? 'Deleting…' : 'Delete wing'}</button>
              </div>
            </div>
            {w.squadrons.length > 0 && (
              <div className="small muted" style={{ marginTop: 4 }}>
                Squadrons in this wing: {w.squadrons.map((s) => s.name).join(', ')}
              </div>
            )}

            {!w.members.length ? (
              <div className="empty" style={{ marginTop: 10 }}>No members. {w.missions + w.events === 0 ? 'Empty wing — use “Delete wing” above.' : ''}</div>
            ) : (
              <div style={{ overflowX: 'auto', marginTop: 10 }}>
                <table>
                  <thead><tr><th>Callsign</th><th>Name</th><th>Squadron</th><th>Discord link</th><th></th></tr></thead>
                  <tbody>
                    {w.members.map((m) => (
                      <tr key={m.id}>
                        <td className="callsign">{m.callsign || '—'}</td>
                        <td className="small">{m.name || '—'}</td>
                        <td className="small">{m.squadron || <span className="muted">wing</span>}</td>
                        <td className="small">
                          {m.linked
                            ? <span title={m.discord_user_id}>✅ {m.discord_user_id}</span>
                            : m.discord_user_id
                              ? <span className="error" title="Not a numeric Discord ID — likely a username typed by hand">⚠️ “{m.discord_user_id}” (not a valid ID)</span>
                              : <span className="muted">— none —</span>}
                        </td>
                        <td>
                          <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                            {targets.length > 0 && (
                              <MoveControl member={m} targets={targets} busy={busy === m.id} onMove={move} />
                            )}
                            <button className="small" title="Remove this roster entry" style={{ color: 'var(--danger, #c0392b)' }} disabled={busy === `m${m.id}`} onClick={() => delMember(m)}>{busy === `m${m.id}` ? '…' : 'Remove'}</button>
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function MoveControl({ member, targets, busy, onMove }) {
  const [wingId, setWingId] = useState('');
  const [sqnId, setSqnId] = useState('');
  const target = targets.find((t) => String(t.id) === String(wingId));
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <select value={wingId} onChange={(e) => { setWingId(e.target.value); setSqnId(''); }} style={{ width: 'auto' }} title="Move to wing">
        <option value="">Move to…</option>
        {targets.map((t) => <option key={t.id} value={t.id}>{t.tag || t.name} #{t.id}</option>)}
      </select>
      {target && target.squadrons.length > 0 && (
        <select value={sqnId} onChange={(e) => setSqnId(e.target.value)} style={{ width: 'auto' }} title="Squadron (optional)">
          <option value="">wing-level</option>
          {target.squadrons.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      )}
      {wingId && (
        <button className="small primary" disabled={busy} onClick={() => onMove(member.id, Number(wingId), sqnId ? Number(sqnId) : null)}>
          {busy ? '…' : 'Move'}
        </button>
      )}
    </span>
  );
}
