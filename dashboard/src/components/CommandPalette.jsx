import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';

// Ctrl/Cmd-K launcher: jump to any page, pilot, mission, or event. Pages are
// always available; entities are prefetched once per open for the active wing
// and filtered client-side (small datasets — no need to hit the server per key).
const PAGES = [
  { label: 'Dashboard', to: '/', kw: 'home overview' },
  { label: 'Events', to: '/events', kw: 'calendar schedule' },
  { label: 'Missions', to: '/missions', kw: 'ops sorties' },
  { label: 'Carriers', to: '/carriers', kw: 'boat greenie lso traps' },
  { label: 'Qualifications', to: '/qualifications', kw: 'quals training board currency' },
  { label: 'Training', to: '/training', kw: 'ip sessions' },
  { label: 'Docs', to: '/docs', kw: 'documents sop library' },
  { label: 'Metrics', to: '/metrics', kw: 'attendance stats export' },
  { label: 'Wing', to: '/wing', kw: 'roster squadrons discord settings' },
];

const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '');

export default function CommandPalette({ activeWing, isAdmin, onClose }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const [entities, setEntities] = useState([]);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Prefetch searchable entities once per open.
  useEffect(() => {
    if (!activeWing) return;
    let alive = true;
    (async () => {
      const [members, missions, events] = await Promise.all([
        api.get(`/api/members?wing_id=${activeWing.id}`).catch(() => []),
        api.get(`/api/missions?wing_id=${activeWing.id}`).catch(() => []),
        api.get(`/api/wings/${activeWing.id}/events?from=${Date.now() - 7 * 86400000}&to=${Date.now() + 60 * 86400000}`).catch(() => []),
      ]);
      if (!alive) return;
      setEntities([
        ...(members || []).map((m) => ({ type: 'Pilot', label: m.callsign || m.name, hint: m.modex ? `#${m.modex}` : '', to: `/members/${m.id}`, kw: `${m.callsign || ''} ${m.name || ''} ${m.modex || ''}` })),
        ...(missions || []).map((m) => ({ type: 'Mission', label: m.name, hint: m.primary_aircraft || '', to: `/missions/${m.id}`, kw: m.name || '' })),
        ...(events || []).map((e) => ({ type: 'Event', label: e.title, hint: fmtDate(e.start_at), to: `/events/${e.id}`, kw: e.title || '' })),
      ]);
    })();
    return () => { alive = false; };
  }, [activeWing]);

  const actions = useMemo(() => {
    const base = PAGES.map((p) => ({ ...p, type: 'Go to' }));
    if (isAdmin) base.push({ type: 'Action', label: 'Create mission', to: '/missions?new=1', kw: 'new add' });
    return base;
  }, [isAdmin]);

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    const pool = [...actions, ...entities];
    if (!term) return actions.slice(0, 10);
    const scored = pool
      .map((it) => {
        const hay = `${it.label} ${it.kw || ''}`.toLowerCase();
        const idx = hay.indexOf(term);
        if (idx === -1) return null;
        // rank: label-prefix < label-contains < keyword-only
        const rank = it.label.toLowerCase().startsWith(term) ? 0 : it.label.toLowerCase().includes(term) ? 1 : 2;
        return { it, rank, idx };
      })
      .filter(Boolean)
      .sort((a, b) => a.rank - b.rank || a.idx - b.idx)
      .slice(0, 12)
      .map((s) => s.it);
    return scored;
  }, [q, actions, entities]);

  useEffect(() => { setSel(0); }, [q]);

  const go = (it) => { if (it) { navigate(it.to); onClose(); } };

  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); go(results[sel]); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };

  return (
    <div className="cmdk-scrim" onClick={onClose}>
      <div className="cmdk" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef} className="cmdk-input" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey}
          placeholder="Jump to a page, pilot, mission, or event…" autoComplete="off" spellCheck="false"
        />
        <div className="cmdk-results">
          {!results.length ? <div className="cmdk-empty">No matches</div> : results.map((it, i) => (
            <button
              key={`${it.type}-${it.to}-${i}`}
              className={`cmdk-item${i === sel ? ' sel' : ''}`}
              onMouseEnter={() => setSel(i)}
              onClick={() => go(it)}
            >
              <span className="cmdk-type">{it.type}</span>
              <span className="cmdk-label">{it.label}</span>
              {it.hint && <span className="cmdk-hint">{it.hint}</span>}
            </button>
          ))}
        </div>
        <div className="cmdk-foot"><kbd>↑↓</kbd> navigate · <kbd>↵</kbd> open · <kbd>esc</kbd> close</div>
      </div>
    </div>
  );
}
