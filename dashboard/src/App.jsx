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
import { VERSION } from './version.js';

const MeContext = createContext(null);
export const useMe = () => useContext(MeContext);

export default function App() {
  const [me, setMe] = useState(undefined); // undefined = loading, null = logged out
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
      (w) => String(w.created_by) === uid || (me.member && me.member.wing_id === w.id),
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
      <header className="topbar">
        <Link to="/" className="brand" aria-label="ReadyRoom"><img src="/logo.png" alt="ReadyRoom" className="brand-logo" /></Link>
        {activeWing && (
          <nav className="nav">
            <NavLink to="/" end>Dashboard</NavLink>
            <NavLink to="/events">Events</NavLink>
            <NavLink to="/missions">Missions</NavLink>
            <NavLink to="/carriers">Carriers</NavLink>
            <NavLink to="/qualifications">Qualifications</NavLink>
            <NavLink to="/training">Training</NavLink>
            <NavLink to="/docs">Docs</NavLink>
            <NavLink to="/metrics">Metrics</NavLink>
            <NavLink to="/wing">Wing</NavLink>
          </nav>
        )}
        <span className="spacer" />
        {myWings.length > 1 && (
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
        )}
        <div className="role-pills">
          {me.isAdmin && <span className="badge admin">ADMIN</span>}
          {me.role === 'commander' && !me.isAdmin && <span className="badge commander">CO</span>}
          {caps.map((c) => <span key={c} className="badge cap">{c}</span>)}
        </div>
        <span className="who">{me.user.username}</span>
        <button className="small" onClick={logout}>Log Out</button>
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
      <DiscordButton />
    </MeContext.Provider>
  );
}
