import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { Routes, Route, Link, NavLink, useNavigate } from 'react-router-dom';
import { api } from './api.js';
import Landing from './pages/Landing.jsx';
import Dashboard from './pages/Dashboard.jsx';
import WingHome from './pages/WingHome.jsx';
import Squadron from './pages/Squadron.jsx';
import MemberDetail from './pages/MemberDetail.jsx';
import Missions from './pages/Missions.jsx';
import MissionDetail from './pages/MissionDetail.jsx';
import TrainingBoard from './pages/TrainingBoard.jsx';
import Calendar from './pages/Calendar.jsx';
import EventDetail from './pages/EventDetail.jsx';
import Metrics from './pages/Metrics.jsx';
import Carriers from './pages/Carriers.jsx';
import CarrierDetail from './pages/CarrierDetail.jsx';
import MyQuals from './pages/MyQuals.jsx';
import CurrencyStatus from './pages/CurrencyStatus.jsx';
import Qualifications from './pages/Qualifications.jsx';
import Training from './pages/Training.jsx';
import Docs from './pages/Docs.jsx';
import AuditLog from './pages/AuditLog.jsx';
import { DiscordButton } from './components/DiscordButton.jsx';
import { AppFooter } from './components/AppFooter.jsx';
import CommandPalette from './components/CommandPalette.jsx';
import { VERSION } from './version.js';

const MeContext = createContext(null);
export const useMe = () => useContext(MeContext);

// Minimal stroke icons for the sidebar (feather-style, inherit currentColor).
function Icon({ name }) {
  const paths = {
    dashboard: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /></>,
    events: <><rect x="3" y="4" width="18" height="17" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></>,
    missions: <><circle cx="12" cy="12" r="7" /><line x1="12" y1="2" x2="12" y2="5" /><line x1="12" y1="19" x2="12" y2="22" /><line x1="2" y1="12" x2="5" y2="12" /><line x1="19" y1="12" x2="22" y2="12" /></>,
    carriers: <><circle cx="12" cy="5" r="3" /><line x1="12" y1="8" x2="12" y2="22" /><path d="M5 12H2a10 10 0 0 0 20 0h-3" /></>,
    qualifications: <><circle cx="12" cy="8" r="6" /><polyline points="8.5 12.9 7 22 12 19 17 22 15.5 12.9" /></>,
    training: <><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><rect x="8" y="2" width="8" height="4" rx="1" /><line x1="8" y1="11" x2="16" y2="11" /><line x1="8" y1="16" x2="13" y2="16" /></>,
    docs: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></>,
    metrics: <><line x1="12" y1="20" x2="12" y2="10" /><line x1="18" y1="20" x2="18" y2="4" /><line x1="6" y1="20" x2="6" y2="16" /></>,
    wing: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></>,
  };
  return (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name] || null}
    </svg>
  );
}

// Server-link LED in the sidebar foot — green while /healthz answers,
// red when the backend is unreachable. Pings once a minute.
function LinkLed() {
  const [ok, setOk] = useState(true);
  useEffect(() => {
    let alive = true;
    const ping = async () => {
      try { const r = await fetch('/healthz'); if (alive) setOk(r.ok); }
      catch { if (alive) setOk(false); }
    };
    ping();
    const t = setInterval(ping, 60000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  return <span className={`led ${ok ? 'on' : 'off'}`} title={ok ? 'Server link OK' : 'Server unreachable'} />;
}

// Sidebar nav: grouped "ops console" sections. Closing the drawer on click
// only matters on mobile (the sidebar is a toggled overlay there).
function SideNav({ onNavigate }) {
  const item = (to, icon, label, end = false) => (
    <NavLink to={to} end={end} onClick={onNavigate}><Icon name={icon} /><span>{label}</span></NavLink>
  );
  return (
    <nav className="side-nav">
      <div className="nav-group">
        <div className="nav-kicker">Operations</div>
        {item('/', 'dashboard', 'Dashboard', true)}
        {item('/events', 'events', 'Events')}
        {item('/missions', 'missions', 'Missions')}
        {item('/carriers', 'carriers', 'Carriers')}
      </div>
      <div className="nav-group">
        <div className="nav-kicker">Training</div>
        {item('/qualifications', 'qualifications', 'Qualifications')}
        {item('/training', 'training', 'Training')}
        {item('/docs', 'docs', 'Docs')}
      </div>
      <div className="nav-group">
        <div className="nav-kicker">Command</div>
        {item('/metrics', 'metrics', 'Metrics')}
        {item('/wing', 'wing', 'Wing')}
      </div>
    </nav>
  );
}

export default function App() {
  const [me, setMe] = useState(undefined); // undefined = loading, null = logged out
  const [navOpen, setNavOpen] = useState(false); // mobile drawer
  const [paletteOpen, setPaletteOpen] = useState(false); // Ctrl/Cmd-K
  const [wings, setWings] = useState([]);
  const [wingsLoaded, setWingsLoaded] = useState(false); // false until /api/wings first resolves
  // Active wing selection persists across reloads. Root admins (and anyone
  // with multiple wings) need this — without it the UI was locked to wings[0]
  // and a freshly spawned demo wing was unreachable.
  const [activeWingId, setActiveWingId] = useState(() => {
    const v = localStorage.getItem('readyroom.activeWingId');
    return v ? Number(v) : null;
  });
  const navigate = useNavigate();

  const loadMe = useCallback(async () => {
    try {
      setMe(await api.get('/api/me'));
    } catch {
      setMe(null);
    }
  }, []);

  const loadWings = useCallback(async () => {
    try {
      setWings(await api.get('/api/wings'));
    } catch {
      setWings([]);
    } finally {
      setWingsLoaded(true);
    }
  }, []);

  useEffect(() => { loadMe(); }, [loadMe]);
  useEffect(() => { if (me) loadWings(); }, [me, loadWings]);

  // Global Ctrl/Cmd-K opens the command palette.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // The wings to actually offer in the switcher. A platform/root admin can
  // technically receive every tenant's wing from /api/wings; curate that down
  // to wings they OWN (created_by) or are a roster member of, so they don't
  // see other squadrons' wings cluttering their dropdown. Safety net: if that
  // filter would hide everything (e.g. ownership not yet backfilled), fall back
  // to the full list so the user is never locked out of their own data.
  // NOTE: declared before the early returns below — Hooks must run every render.
  const myWings = useMemo(() => {
    if (!me?.user || !wings.length) return wings;
    const uid = String(me.user.id);
    const mine = wings.filter(
      (w) => String(w.created_by) === uid
        || (me.member && me.member.wing_id === w.id)
        // Unowned wings (created before ownership tracking, e.g. an early demo
        // wing). Only a root/owner ever RECEIVES these from /api/wings — a
        // regular member only gets their own wing — so this surfaces orphaned
        // wings to the owner without exposing other squadrons' (which are now
        // attributed via created_by).
        || w.created_by == null,
    );
    return mine.length ? mine : wings;
  }, [wings, me]);

  if (me === undefined) {
    return <div className="login-wrap"><div className="muted">Loading…</div></div>;
  }
  if (!me) return <><Landing /><DiscordButton /></>;

  // Role + capability badges shown in the top bar so the user always sees
  // which hats they're wearing. ADMIN/COMMANDER come from app_role; LSO/JTAC/
  // etc. come from the comma-separated capabilities field on their member.
  const caps = (me.member?.capabilities || '').split(',').map((c) => c.trim()).filter(Boolean);

  // Resolve the active wing: saved selection if it's still in my list,
  // otherwise my first wing. Falls back gracefully when a wing is deleted.
  const activeWing = myWings.find((w) => w.id === activeWingId) || myWings[0] || null;
  const switchWing = (id) => {
    setActiveWingId(id);
    localStorage.setItem('readyroom.activeWingId', String(id));
    navigate('/');
  };
  const logout = async () => {
    await api.post('/auth/logout');
    setMe(null);
    navigate('/');
  };

  return (
    <MeContext.Provider value={{ me, reload: loadMe, wings, wingsLoaded, activeWing, reloadWings: loadWings }}>
      <div className={`shell${navOpen ? ' nav-open' : ''}`}>
        <aside className={`sidebar${navOpen ? ' open' : ''}`}>
          <Link to="/" className="brand" aria-label="ReadyRoom" onClick={() => setNavOpen(false)}>
            <img src="/logo.png" alt="ReadyRoom" className="brand-logo" />
          </Link>
          {activeWing && <SideNav onNavigate={() => setNavOpen(false)} />}
          <div className="sidebar-foot">
            <LinkLed />
            <span className="who" title={me.user.username}>{me.user.username}</span>
            <button className="small" onClick={logout}>Log Out</button>
          </div>
        </aside>
        {/* tapping the dimmed page closes the mobile drawer */}
        <div className="nav-scrim" onClick={() => setNavOpen(false)} />
        <div className="main-col">
          <header className="topbar">
            <button className="nav-burger" aria-label="Menu" onClick={() => setNavOpen((v) => !v)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="4" y1="7" x2="20" y2="7" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="17" x2="20" y2="17" />
              </svg>
            </button>
            <button className="cmdk-trigger" onClick={() => setPaletteOpen(true)} title="Search (Ctrl+K)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <span className="cmdk-trigger-label">Search</span>
              <kbd>Ctrl K</kbd>
            </button>
            <span className="spacer" />
            {activeWing && (myWings.length > 1 ? (
              // 2+ wings: a real switcher.
              <select
                className="wing-switch"
                value={activeWing?.id || ''}
                onChange={(e) => switchWing(Number(e.target.value))}
                title="Switch wing"
                style={{ width: 'auto', maxWidth: 180, marginRight: 8 }}
              >
                {myWings.map((w) => {
                  const label = w.tag || w.name;
                  // Disambiguate identical labels (e.g. two spawned demo wings)
                  const dupe = myWings.some((o) => o.id !== w.id && (o.tag || o.name) === label);
                  return <option key={w.id} value={w.id}>{dupe ? `${label} #${w.id}` : label}</option>;
                })}
              </select>
            ) : (
              // Single wing: still show which wing you're in, so the context (and
              // where a switcher would appear) is always visible.
              <span className="wing-label muted small" title="Your active wing" style={{ marginRight: 8, fontWeight: 700 }}>
                {activeWing.tag || activeWing.name}
              </span>
            ))}
            <div className="role-pills">
              {me.isAdmin && <span className="badge admin">ADMIN</span>}
              {me.role === 'commander' && !me.isAdmin && <span className="badge commander">CO</span>}
              {caps.map((c) => <span key={c} className="badge cap">{c}</span>)}
            </div>
          </header>
          <main className="container">
            <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/wing" element={<WingHome />} />
          <Route path="/missions" element={<Missions />} />
          <Route path="/missions/:id" element={<MissionDetail />} />
          <Route path="/squadrons/:id" element={<Squadron />} />
          <Route path="/members/:id" element={<MemberDetail />} />
          <Route path="/training/:qualId" element={<TrainingBoard />} />
          <Route path="/events" element={<Calendar />} />
          <Route path="/events/:id" element={<EventDetail />} />
          <Route path="/metrics" element={<Metrics />} />
          <Route path="/carriers" element={<Carriers />} />
          <Route path="/carriers/:id" element={<CarrierDetail />} />
          <Route path="/qualifications" element={<Qualifications />} />
          <Route path="/training" element={<Training />} />
          <Route path="/docs" element={<Docs />} />
          <Route path="/audit-log" element={<AuditLog />} />
              {/* Standalone routes kept for back-compat / direct linking */}
              <Route path="/my-quals" element={<MyQuals />} />
              <Route path="/currency" element={<CurrencyStatus />} />
            </Routes>
          </main>
          <AppFooter me={me} version={VERSION} />
        </div>
      </div>
      {paletteOpen && <CommandPalette activeWing={activeWing} isAdmin={me.isAdmin} onClose={() => setPaletteOpen(false)} />}
      <DiscordButton />
    </MeContext.Provider>
  );
}
