import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useMe } from '../App.jsx';

// Focused, in-app-browser-aware sign-in screen for ANY logged-out visitor who
// arrived on a real destination — a /claim/<token> link OR an /events/:id or
// /missions/:id deep link tapped from a Discord ops post. One clear sign-in
// action that carries the destination through login server-side (?next=), plus
// a warning when opened inside an in-app webview (Discord/FB/IG), where the
// OAuth cookie round-trip silently breaks — the #1 cause of "I authorize and
// the screen just sits there / it keeps asking me to verify."
export function LoginGate({ next, title = 'Sign in to ReadyRoom', blurb = 'Log in with Discord to continue.' }) {
  const inApp = typeof navigator !== 'undefined'
    && /(Discord|FBAN|FBAV|FB_IAB|Instagram|Line|GSA)/i.test(navigator.userAgent);
  const err = new URLSearchParams(window.location.search).get('error');
  // The full URL the pilot should open in a real browser = origin + destination.
  const url = `${window.location.origin}${next || '/'}`;
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { /* clipboard blocked — user can long-press the text */ }
  };
  const loginHref = `/auth/login${next ? `?next=${encodeURIComponent(next)}` : ''}`;
  return (
    <div className="login-wrap">
      <div className="card" style={{ width: 'min(440px, 92vw)', textAlign: 'center' }}>
        <h1 style={{ marginTop: 0 }}>{title}</h1>
        <p className="muted">{blurb}</p>
        {err && (
          <p className="error">Sign-in didn't finish{err === 'invalid_state' ? " — usually the in-app browser blocking it." : '.'} Try again below.</p>
        )}
        {inApp && (
          <div className="callout" style={{ textAlign: 'left' }}>
            <p style={{ marginTop: 0 }}><b>You're in an in-app browser</b> (opened from inside Discord), which blocks Discord sign-in. Open this link in your real browser — Safari, Chrome, or Edge:</p>
            <code style={{ wordBreak: 'break-all', display: 'block', margin: '6px 0' }}>{url}</code>
            <button className="small primary" onClick={copy}>{copied ? 'Copied ✓' : 'Copy link'}</button>
            <p className="small muted" style={{ marginBottom: 0 }}>Tip: tap the ⋯ menu (usually top-right) → <b>Open in browser</b>.</p>
          </div>
        )}
        <a className="btn-discord" href={loginHref} style={{ marginTop: 12, display: 'inline-flex' }}>
          {inApp ? 'Try signing in anyway' : 'Log In with Discord'}
        </a>
      </div>
    </div>
  );
}

// Claim-link entry: the roster-linking flavor of the sign-in gate.
export function ClaimLogin({ token }) {
  return (
    <LoginGate
      next={`/claim/${token}`}
      title="Claim your pilot"
      blurb="Sign in with Discord to link your account to your squadron's roster."
    />
  );
}

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

  const claim = async (memberId, callsign) => {
    const linked = data.already_linked;
    // Re-home: the pilot is linked in a DIFFERENT group (a stuck trial/demo
    // wing). Switching them here removes that old entry, so confirm explicitly.
    const rehome = !!(linked && !linked.same_wing);
    if (rehome && !confirm(
      `Link your Discord to ${callsign} in ${data.wing.tag || data.wing.name}?\n\n`
      + `You're currently linked to ${linked.callsign} in ${linked.wing_name || 'another group'} — `
      + 'this moves you here and removes that old entry.'
    )) return;
    setBusy(true); setErr('');
    try {
      await api.post(`/api/claim/${token}`, { member_id: memberId, rehome });
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

      {data.already_linked && data.already_linked.same_wing ? (
        // Already linked HERE — nothing to switch.
        <div className="card">
          <p style={{ marginTop: 0 }}>Your Discord is already linked to <b>{data.already_linked.callsign}</b> in this group.</p>
          <button className="primary" onClick={() => navigate('/')}>Go to ReadyRoom →</button>
        </div>
      ) : (
        <>
          {data.already_linked ? (
            // Linked in a DIFFERENT group (a stuck trial/demo wing) — offer to switch.
            <div className="callout" style={{ marginBottom: 12 }}>
              <p style={{ marginTop: 0 }}>Your Discord is currently linked to <b>{data.already_linked.callsign}</b> in <b>{data.already_linked.wing_name || 'another group'}</b>{data.already_linked.solo ? ' (a group with just you in it)' : ''}.</p>
              <p style={{ marginBottom: 0 }}>Pick your name below to <b>switch into {data.wing.tag || data.wing.name}</b> — you'll be moved here and the old entry removed.</p>
            </div>
          ) : (
            <p className="small muted">Find your name and claim it to link your Discord. Don't see yourself? Ask your squadron admin to add you to the roster first.</p>
          )}
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
                    <button className="small primary" disabled={busy} onClick={() => claim(m.id, m.callsign || m.name)}>
                      {data.already_linked ? 'Switch to this' : 'This is me'}
                    </button>
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
