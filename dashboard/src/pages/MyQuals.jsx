/**
 * Pilot-facing qualifications view. Mirrors Deckboss's "My Qualifications" tab.
 *
 * Top-level destination for any logged-in pilot — they shouldn't have to dig
 * into their member detail page to see what they're qualified on, what's in
 * progress, and what's expiring.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useMe } from '../App.jsx';

const FILTERS = [
  { key: 'all',         label: 'All' },
  { key: 'qualified',   label: 'Current' },
  { key: 'training',    label: 'In progress' },
  { key: 'expired',     label: 'Expired' },
];

const fmt = (ms) => (ms ? new Date(ms).toLocaleDateString() : '—');

export default function MyQuals() {
  const { me, activeWing } = useMe();
  const [allQuals, setAllQuals] = useState(null); // wing's qual definitions
  const [memberFull, setMemberFull] = useState(null); // member with .quals
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    if (!activeWing || !me.member) return;
    api.get(`/api/quals?wing_id=${activeWing.id}`).then(setAllQuals);
    api.get(`/api/members/${me.member.id}`).then(setMemberFull);
  }, [activeWing, me.member?.id]);

  if (!me.member) {
    return (
      <div className="empty">
        Your Discord isn't linked to a roster member yet, so we can't show your quals.
        Ask an admin to link you on your member page.
      </div>
    );
  }
  if (!allQuals || !memberFull) return <p className="muted">Loading…</p>;

  // Held quals keyed by qual_id for quick lookup.
  const held = new Map((memberFull.quals || []).map((q) => [q.qual_id, q]));

  // Build the display list — every wing qual, decorated with the member's
  // state (or "not assigned" if they don't have it).
  const decorated = allQuals.map((q) => {
    const mq = held.get(q.id) || null;
    return {
      ...q,
      member_status: mq?.status || 'unassigned',
      awarded_at: mq?.awarded_at || null,
      expires_at: mq?.expires_at || null,
      progress: mq?.progress || null,
    };
  });

  const shown = filter === 'all'
    ? decorated.filter((d) => d.member_status !== 'unassigned')
    : decorated.filter((d) => d.member_status === filter);

  // KPI footer counts
  const counts = {
    achieved:    decorated.filter((d) => d.member_status === 'qualified' && (!d.expires_at || d.expires_at > Date.now())).length,
    inProgress:  decorated.filter((d) => d.member_status === 'training').length,
    current:     decorated.filter((d) => d.member_status === 'qualified').length,
    expired:     decorated.filter((d) => d.member_status === 'expired').length,
  };

  return (
    <div>
      <div className="between">
        <h1>My Qualifications</h1>
        <div className="row" style={{ gap: 4 }}>
          {FILTERS.map((f) => (
            <button key={f.key}
              className={`small ${filter === f.key ? 'primary' : ''}`}
              onClick={() => setFilter(f.key)}>{f.label}</button>
          ))}
        </div>
      </div>
      <p className="muted small">
        {memberFull.callsign ? `${memberFull.rank || ''} "${memberFull.callsign}"`.trim() : memberFull.name}
        {memberFull.modex && <> · modex {memberFull.modex}</>}
      </p>

      {!shown.length && <div className="empty">No qualifications match this filter.</div>}

      {shown.map((q) => <QualCard key={q.id} qual={q} memberId={memberFull.id} />)}

      <div className="kpi-grid" style={{ marginTop: 16 }}>
        <KpiMini label="Achieved"     value={counts.achieved}   color="#4cd964" />
        <KpiMini label="In Progress"  value={counts.inProgress} color="#ffcc00" />
        <KpiMini label="Current"      value={counts.current}    color="#4c8bf5" />
        <KpiMini label="Expired"      value={counts.expired}    color="#ff6464" />
      </div>
    </div>
  );
}

function QualCard({ qual, memberId }) {
  const status = qual.member_status;
  const expiringSoon = qual.expires_at && qual.expires_at - Date.now() < 30 * 86_400_000 && qual.expires_at > Date.now();
  const badgeKind = status === 'qualified' ? (expiringSoon ? 'training' : 'qualified')
    : status === 'training' ? 'training'
    : status === 'expired' ? 'expired'
    : 'reserve';
  const badgeLabel = status === 'qualified' ? (expiringSoon ? 'Expiring soon' : 'Current')
    : status === 'training' ? 'In progress'
    : status === 'expired' ? 'Expired'
    : 'Not assigned';
  const progPct = qual.progress?.total ? Math.round((qual.progress.signed / qual.progress.total) * 100) : 0;
  return (
    <section className="card" style={{ marginBottom: 12 }}>
      <div className="between">
        <div>
          <h3 style={{ margin: '0 0 4px' }}>{qual.code} <span className="muted small" style={{ fontWeight: 400 }}>· {qual.name}</span></h3>
          {qual.description && <p className="small muted" style={{ marginTop: 4 }}>{qual.description}</p>}
        </div>
        <span className={`badge ${badgeKind}`} style={{ flex: '0 0 auto' }}>{badgeLabel}</span>
      </div>
      {qual.progress?.total > 0 && (
        <div style={{ marginTop: 10 }}>
          <div className="small muted" style={{ marginBottom: 4 }}>
            Progress · {qual.progress.signed} of {qual.progress.total} activities
          </div>
          <div style={{ height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ width: `${progPct}%`, height: '100%', background: 'var(--accent)', transition: 'width 200ms' }} />
          </div>
        </div>
      )}
      <div className="row small muted" style={{ marginTop: 10, gap: 24 }}>
        {qual.awarded_at && <span><b>Awarded:</b> {fmt(qual.awarded_at)}</span>}
        {qual.expires_at && <span><b>Expires:</b> {fmt(qual.expires_at)}</span>}
        <Link to={`/members/${memberId}`} style={{ marginLeft: 'auto' }}>View activities →</Link>
      </div>
    </section>
  );
}

function KpiMini({ label, value, color }) {
  return (
    <div className="kpi-tile" style={{ borderTop: `3px solid ${color}` }}>
      <div className="kpi-value" style={{ color }}>{value}</div>
      <div className="kpi-label">{label}</div>
    </div>
  );
}
