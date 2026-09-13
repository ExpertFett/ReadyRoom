import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useMe } from '../App.jsx';

// Root-only, platform-wide roster console. ReadyRoom is MULTI-TENANT: every
// wing (group) is an independent org with its own squadrons, missions, events
// and ops posts — there is no canonical "real" wing. This lists every group,
// its squadrons, and where each pilot's Discord account is linked, and lets the
// owner move a pilot to the correct group, remove a stray entry, or delete a
// leftover/demo group. A pilot only sees missions/events in the group their
// account belongs to, so a pilot linked to the wrong group 403s — the fix is to
// move them to the group they actually belong to (the owner decides which; the
// tool never guesses). See /api/admin/link-report + move-member/delete-*.
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
  const totalMembers = wings.reduce((n, w) => n + w.members.length, 0);
  // The one universally-correct flag in a multi-group world: a "Discord ID" that
  // isn't a numeric snowflake (a hand-typed username) — that pilot can't log in
  // or be matched, in ANY group. Everything else (who belongs where) is the
  // owner's call, not something to auto-detect.
  const badIds = wings.reduce((n, w) => n + w.members.filter((m) => m.discord_user_id && !m.linked).length, 0);

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

  const setRole = async (m, makeAdmin) => {
    setBusy(`r${m.id}`);
    try {
      await api.post('/api/admin/set-member-role', { member_id: m.id, role: makeAdmin ? 'admin' : 'member' });
      await load();
    } catch (e) {
      alert(`Role change failed${e.status ? ` (${e.status})` : ''}.`);
    } finally { setBusy(0); }
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
      <p className="muted">Every group (wing), its squadrons, and where each pilot's Discord account is linked. These are independent groups — a pilot only sees missions/events in the group their account belongs to, so a pilot linked to the wrong group will 403. Move, remove, or delete as needed.</p>

      <div className="card" style={{ marginBottom: 14 }}>
        <b>{wings.length}</b> group{wings.length === 1 ? '' : 's'} · <b>{totalMembers}</b> pilot{totalMembers === 1 ? '' : 's'} across all of them.
        {badIds > 0 && (
          <span className="error"> {badIds} {badIds === 1 ? 'has' : 'have'} an invalid Discord ID (a hand-typed username, not a numeric ID) — they can't log in or be matched anywhere. Fix those below (⚠️ rows).</span>
        )}
      </div>

      {wings.map((w) => {
        const linked = w.members.filter((m) => m.linked).length;
        const targets = wings.filter((t) => t.id !== w.id);
        return (
          <section key={w.id} className="card" style={{ marginBottom: 14 }}>
            <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
              <h2 style={{ margin: 0 }}>
                {w.name}{w.tag && w.tag !== w.name ? <span className="muted small"> ({w.tag})</span> : null} <span className="muted small">group #{w.id}</span>
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
                        <td className="callsign">{m.callsign || '—'}{m.is_admin && <span className="badge admin" style={{ marginLeft: 6 }}>OWNER</span>}</td>
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
                            {m.is_admin
                              ? <button className="small" title="Remove group-owner (admin) rights" disabled={busy === `r${m.id}`} onClick={() => setRole(m, false)}>{busy === `r${m.id}` ? '…' : 'Remove owner'}</button>
                              : <button className="small" title="Make this pilot a group owner (admin) — can manage the group + export CSVs" disabled={busy === `r${m.id}` || !m.linked} onClick={() => setRole(m, true)}>{busy === `r${m.id}` ? '…' : 'Make owner'}</button>}
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
