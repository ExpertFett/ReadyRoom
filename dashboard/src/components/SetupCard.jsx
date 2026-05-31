/**
 * Onboarding walkthrough — shows on the Dashboard until the wing is set up.
 *
 * Backed by GET /api/wings/:id/setup-status. Each step is checked from the
 * actual data (squadron count, qual count, roster size, did-the-DCS-hook-fire,
 * is-Discord-wired). When all required steps are done, the card disappears.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

// Step definitions in display order. `to` is the page where you go to do it;
// `cta` is the button label. `optional` items don't count toward "all done".
const STEPS = [
  {
    key: 'squadrons',
    title: 'Add your squadrons',
    body: 'Build out the org tree — fighter squadron, LSO det, training command, whatever shape your wing takes.',
    to: '/wing',
    cta: 'Open Wing page',
  },
  {
    key: 'quals',
    title: 'Define your qualifications',
    body: 'CMQ, FMQ, Section Lead, JTAC, LSO — whatever your wing actually trains to. These drive readiness tiers and the training board.',
    to: '/wing',
    cta: 'Manage quals',
  },
  {
    key: 'roster',
    title: 'Populate the roster',
    body: 'Add at least a handful of pilots — by hand on the squadron page, or bulk-import from CSV (callsigns, ranks, modex, Discord IDs, capability tags).',
    to: '/wing',
    cta: 'Add / import pilots',
  },
  {
    key: 'dcs_hook',
    title: 'Wire the DCS in-game hook',
    body: "Drop a small Lua hook into your server's Scripts/Hooks folder so sorties stream into ReadyRoom — matched to roster pilots by their in-game name. Once your first sortie lands, this step ticks itself green.",
    to: '/wing',
    cta: 'Get hook URL',
  },
  {
    key: 'discord',
    title: 'Wire the Ops Bot Discord bridge',
    body: 'Two-way bridge: events you create here drop an embed in your squadron Discord. Copy the URL + outbound token from your Ops Bot dashboard → DCS Server → ReadyRoom integration → Inbound.',
    to: '/wing',
    cta: 'Configure Discord',
  },
  {
    key: 'carrier',
    title: 'Add a carrier (optional)',
    body: "If you're running a naval wing, add a ship to start logging traps and building the LSO greenie board.",
    to: '/carriers',
    cta: 'Open Carriers',
    optional: true,
  },
];

export default function SetupCard({ wingId, isAdmin }) {
  const [status, setStatus] = useState(null);
  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    if (!wingId) return;
    api.get(`/api/wings/${wingId}/setup-status`).then(setStatus).catch(() => setStatus(null));
  }, [wingId]);

  if (!isAdmin || !status || dismissed) return null;
  const allRequiredDone = status.complete >= status.total;
  if (allRequiredDone) return null;

  const pct = Math.round((status.complete / status.total) * 100);

  return (
    <section className="card" style={{ marginTop: 8, borderLeft: '3px solid var(--accent, #4c8bf5)' }}>
      <div className="between" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <h3 style={{ margin: '0 0 4px' }}>Get your wing set up</h3>
          <div className="small muted" style={{ marginBottom: 10 }}>
            {status.complete} of {status.total} required steps done · {pct}%
          </div>
          <div style={{ height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden', marginBottom: 14 }}>
            <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent, #4c8bf5)', transition: 'width 200ms' }} />
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="small" onClick={() => setExpanded((v) => !v)}>{expanded ? 'Collapse' : 'Expand'}</button>
          <button className="small" onClick={() => setDismissed(true)} title="Hide until reload">×</button>
        </div>
      </div>

      {expanded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {STEPS.map((step) => {
            const state = status.steps[step.key];
            if (!state) return null;
            const done = state.done;
            return (
              <div key={step.key} style={{
                display: 'flex', gap: 12, alignItems: 'flex-start',
                padding: '10px 12px',
                background: done ? 'rgba(76,217,100,0.06)' : 'rgba(255,255,255,0.02)',
                border: '1px solid var(--border, rgba(255,255,255,0.08))',
                borderRadius: 6,
                opacity: done ? 0.7 : 1,
              }}>
                <div style={{
                  width: 26, height: 26, flex: '0 0 26px',
                  borderRadius: '50%',
                  background: done ? '#4cd964' : 'transparent',
                  border: done ? 'none' : '2px solid var(--border, rgba(255,255,255,0.2))',
                  color: '#000', fontWeight: 800, fontSize: 14,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {done ? '✓' : ''}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>
                    {step.title}
                    {step.optional && <span className="muted small" style={{ marginLeft: 6 }}>(optional)</span>}
                    {state.count > 0 && !done && <span className="muted small" style={{ marginLeft: 6 }}>· {state.count} so far</span>}
                  </div>
                  <div className="small muted" style={{ marginTop: 2 }}>{step.body}</div>
                </div>
                {!done && (
                  <Link to={step.to} className="btn small primary" style={{ alignSelf: 'center', whiteSpace: 'nowrap' }}>
                    {step.cta} →
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
