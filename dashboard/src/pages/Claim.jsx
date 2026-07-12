import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useMe } from '../App.jsx';

// Self-serve pilot linking: a pilot opens a wing's claim link, logs in, and
// picks their own (unlinked) roster member to link their Discord account.
export default function Claim() {
  const { token } = useParams();
  const { reload } = useMe();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => api.get(`/api/claim/${token}`).then(setData)
    .catch((e) => setErr(e.data?.error === 'bad_token' ? 'This claim link is invalid or expired — ask your squadron admin for a fresh one.' : 'Could not load the roster.'));
  useEffect(() => { load(); }, [token]);

  const claim = async (memberId) => {
    setBusy(true); setErr('');
    try {
      await api.post(`/api/claim/${token}`, { member_id: memberId });
      await reload();
      navigate('/');
    } catch (e) {
      const map = {
        already_linked: 'Your Discord is already linked to a pilot.',
        taken: 'Someone just claimed that pilot — pick another or ask an admin.',
        bad_member: "That pilot isn't on this roster.",
      };
      setErr(map[e.data?.error] || 'Could not claim that pilot.');
      load(); // refresh — the list may have changed
    } finally { setBusy(false); }
  };

  if (err && !data) return <div className="empty" style={{ marginTop: 40 }}>{err}</div>;
  if (!data) return <p className="muted">Loading…</p>;

  const groups = {};
  for (const m of data.members) {
    const k = m.sqn_tag || m.sqn_name || 'Wing staff';
    (groups[k] ||= []).push(m);
  }

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <h1>Claim your pilot</h1>
      <p className="muted">{data.wing.tag ? `${data.wing.tag} — ` : ''}{data.wing.name}</p>

      {data.already_linked ? (
        <div className="card">
          <p style={{ marginTop: 0 }}>Your Discord is already linked to <b>{data.already_linked.callsign}</b>.</p>
          <button className="primary" onClick={() => navigate('/')}>Go to ReadyRoom →</button>
        </div>
      ) : (
        <>
          <p className="small muted">Find your name and claim it to link your Discord. Don't see yourself? Ask your squadron admin to add you to the roster first.</p>
          {err && <p className="error">{err}</p>}
          {!data.members.length ? (
            <div className="empty">No unclaimed pilots on this roster right now.</div>
          ) : Object.entries(groups).map(([g, members]) => (
            <section key={g}>
              <h2>{g}</h2>
              <div className="card" style={{ padding: 0 }}>
                {members.map((m) => (
                  <div key={m.id} className="list-row" style={{ padding: '10px 14px' }}>
                    <div>
                      <div className="callsign">{m.callsign || m.name}{m.modex ? ` · ${m.modex}` : ''}</div>
                      {m.callsign && m.name && <div className="small muted">{m.name}</div>}
                    </div>
                    <button className="small primary" disabled={busy} onClick={() => claim(m.id)}>This is me</button>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
