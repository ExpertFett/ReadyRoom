import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { Routes, Route, Link, useNavigate } from 'react-router-dom';
import { api } from './api.js';
import Login from './pages/Login.jsx';
import WingHome from './pages/WingHome.jsx';
import Squadron from './pages/Squadron.jsx';
import MemberDetail from './pages/MemberDetail.jsx';

const MeContext = createContext(null);
export const useMe = () => useContext(MeContext);

export default function App() {
  const [me, setMe] = useState(undefined); // undefined = loading, null = logged out
  const navigate = useNavigate();

  const loadMe = useCallback(async () => {
    try {
      setMe(await api.get('/api/me'));
    } catch {
      setMe(null);
    }
  }, []);

  useEffect(() => { loadMe(); }, [loadMe]);

  if (me === undefined) {
    return <div className="login-wrap"><div className="muted">Loading…</div></div>;
  }
  if (!me) return <Login />;

  const logout = async () => {
    await api.post('/auth/logout');
    setMe(null);
    navigate('/');
  };

  return (
    <MeContext.Provider value={{ me, reload: loadMe }}>
      <header className="topbar">
        <Link to="/" className="brand">READY<span className="tag">ROOM</span></Link>
        <span className="spacer" />
        {me.isAdmin && <span className="badge admin">ADMIN</span>}
        <span className="who">{me.user.username}</span>
        <button className="small" onClick={logout}>Sign out</button>
      </header>
      <main className="container">
        <Routes>
          <Route path="/" element={<WingHome />} />
          <Route path="/squadrons/:id" element={<Squadron />} />
          <Route path="/members/:id" element={<MemberDetail />} />
        </Routes>
      </main>
    </MeContext.Provider>
  );
}
