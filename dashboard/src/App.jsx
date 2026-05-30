import { createContext, useContext, useEffect, useState, useCallback } from 'react';
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

const MeContext = createContext(null);
export const useMe = () => useContext(MeContext);

export default function App() {
  const [me, setMe] = useState(undefined); // undefined = loading, null = logged out
  const [wings, setWings] = useState([]);
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
    }
  }, []);

  useEffect(() => { loadMe(); }, [loadMe]);
  useEffect(() => { if (me) loadWings(); }, [me, loadWings]);

  if (me === undefined) {
    return <div className="login-wrap"><div className="muted">Loading…</div></div>;
  }
  if (!me) return <Landing />;

  const activeWing = wings[0] || null;
  const logout = async () => {
    await api.post('/auth/logout');
    setMe(null);
    navigate('/');
  };

  return (
    <MeContext.Provider value={{ me, reload: loadMe, wings, activeWing, reloadWings: loadWings }}>
      <header className="topbar">
        <Link to="/" className="brand" aria-label="ReadyRoom"><img src="/logo.png" alt="ReadyRoom" className="brand-logo" /></Link>
        {activeWing && (
          <nav className="nav">
            <NavLink to="/" end>Dashboard</NavLink>
            <NavLink to="/events">Events</NavLink>
            <NavLink to="/missions">Missions</NavLink>
            <NavLink to="/metrics">Metrics</NavLink>
            <NavLink to="/wing">Wing</NavLink>
          </nav>
        )}
        <span className="spacer" />
        {me.isAdmin && <span className="badge admin">ADMIN</span>}
        <span className="who">{me.user.username}</span>
        <button className="small" onClick={logout}>Sign out</button>
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
        </Routes>
      </main>
    </MeContext.Provider>
  );
}
