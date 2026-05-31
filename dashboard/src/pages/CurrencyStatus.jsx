/**
 * Currency Status — wing-wide expiration dashboard.
 *
 * One page lists every expiration across every pilot, filterable by status
 * (expired / expiring / current) and by pilot / qual. Admins can renew
 * directly from the row by picking a new "last renewed" date.
 *
 * Mirrors Deckboss's "Currency Status" tab.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useMe } from '../App.jsx';

const fmt = (ms) => (ms ? new Date(ms).toLocaleDateString() : '—');
const DAY = 86_400_000;

export default function CurrencyStatus() {
  const { me, activeWing } = useMe();
  const [rows, setRows] = useState(null);
  const [filter, setFilter] = useState('all');
  const [pilotFilter, setPilotFilter] = useState('');
  const [qualFilter, setQualFilter] = useState('');

  const load = async () => {
    if (!activeWing) return;
    setRows(await api.get(`/api/wings/${activeWing.id}/currency`));
  };
  useEffect(() => { load(); }, [activeWing]);

  if (!activeWing) return <div className="empty">No wing yet.</div>;
  if (rows === null) return <p className="muted">Loading…</p>;

  // Counts for KPI tiles + filter chip badges.
  const counts = {
    all:      rows.length,
    expired:  rows.filter((r) => r.status === 'expired').length,
    expiring: rows.filter((r) => r.status === 'expiring').length,
    current:  rows.filter((r) => r.status === 'current').length,
  };

  // Unique pilot + qual lists for the dropdown filters.
  const pilots = [...new Set(rows.map((r) => r.callsign).filter(Boolean))].sort();
  const quals  = [...new Set(rows.map((r) => r.code).filter(Boolean))].sort();

  const shown = rows.filter((r) => {
    if (filter !== 'all' && r.status !== filter) return false;
    if (pilotFilter && r.callsign !== pilotFilter) return false;
    if (qualFilter && r.code !== qualFilter) return false;
    return true;
  });

  return (
    <div>
      <h1>Currency Status</h1>
      <p className="muted">Wing-wide qualification expirations. Click <b>Renew</b> to record a new sign-off date.</p>

      <div className="kpi-grid">
        <KpiMini label="Total"        value={counts.all}      color="#4c8bf5" />
        <KpiMini label="Expired"      value={counts.expired}  color="#ff6464" />
        <KpiMini label="Expiring"     value={counts.expiring} color="#ffcc00" />
        <KpiMini label="Current"      value={counts.current}  color="#4cd964" />
      </div>

      <div className="card" style={{ padding: 10, marginBottom: 12 }}>
        <div className="row" style={{ alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {[
            { k: 'all',      label: `All (${counts.all})`       },
            { k: 'expired',  label: `Expired (${counts.expired})` },
            { k: 'expiring', label: `Expiring (${counts.expiring})` },
            { k: 'current',  label: `Current (${counts.current})`  },
          ].map((b) => (
            <button key={b.k}
              className={`small ${filter === b.k ? 'primary' : ''}`}
              onClick={() => setFilter(b.k)}>{b.label}</button>
          ))}
          <span style={{ flex: 1 }} />
          <select value={pilotFilter} onChange={(e) => setPilotFilter(e.target.value)}>
            <option value="">All pilots</option>
            {pilots.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select value={qualFilter} onChange={(e) => setQualFilter(e.target.value)}>
            <option value="">All qualifications</option>
            {quals.map((q) => <option key={q} value={q}>{q}</option>)}
          </select>
        </div>
      </div>

      {!shown.length ? <div className="empty">Nothing to show with these filters.</div> : (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Pilot</th>
                <th>Qualification</th>
                <th>Last Awarded</th>
                <th>Expires</th>
                <th>Status</th>
                {me.isAdmin && <th>Action</th>}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <CurrencyRow key={`${r.member_id}-${r.qual_id}`} row={r} canEdit={me.isAdmin} onRenewed={load} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CurrencyRow({ row, canEdit, onRenewed }) {
  const today = new Date().toISOString().slice(0, 10);
  const [renewDate, setRenewDate] = useState(today);
  const [busy, setBusy] = useState(false);

  const renew = async () => {
    setBusy(true);
    try {
      const awardedMs = new Date(renewDate).getTime();
      const expiresMs = row.currency_days
        ? awardedMs + row.currency_days * DAY
        : null;
      await api.put(`/api/members/${row.member_id}/quals/${row.qual_id}`, {
        status: 'qualified',
        awarded_at: awardedMs,
        expires_at: expiresMs,
      });
      onRenewed();
    } finally { setBusy(false); }
  };

  const statusBadge = {
    expired:  { kind: 'expired',   label: row.days_remaining != null ? `Expired ${Math.abs(row.days_remaining)}d ago` : 'Expired' },
    expiring: { kind: 'training',  label: `${row.days_remaining}d left` },
    current:  { kind: 'qualified', label: row.days_remaining != null ? `${row.days_remaining}d left` : 'Current' },
  }[row.status] || { kind: 'reserve', label: row.status };

  return (
    <tr>
      <td>
        <Link to={`/members/${row.member_id}`} className="callsign">{row.callsign || `#${row.member_id}`}</Link>
        {row.modex && <span className="muted small"> · {row.modex}</span>}
        {row.sqn_tag && <span className="muted small"> · {row.sqn_tag}</span>}
      </td>
      <td><b>{row.code}</b> <span className="muted small">{row.qual_name}</span></td>
      <td className="small mono">{fmt(row.awarded_at)}</td>
      <td className="small mono">{fmt(row.expires_at)}</td>
      <td><span className={`badge ${statusBadge.kind}`}>{statusBadge.label}</span></td>
      {canEdit && (
        <td>
          <div className="row" style={{ gap: 4, alignItems: 'center' }}>
            <input type="date" value={renewDate} onChange={(e) => setRenewDate(e.target.value)} style={{ padding: '2px 6px' }} />
            <button className="small primary" disabled={busy} onClick={renew}>Renew</button>
          </div>
        </td>
      )}
    </tr>
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
