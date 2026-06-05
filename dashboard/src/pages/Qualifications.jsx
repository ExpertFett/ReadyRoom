/**
 * Qualifications hub — consolidates everything qual-related under one route.
 *
 * Sub-tabs:
 *   Overview        — wing's qual list w/ classifier badges + create new
 *   My Quals        — pilot-facing personal view (reuses MyQuals.jsx)
 *   Currency        — wing-wide expiration dashboard (reuses CurrencyStatus.jsx)
 *   Training Board  — picks a qual, drops into the existing TrainingBoard page
 *   Bulk Assign     — multi-pilot multi-qual assignment workflow
 *   Bulk Sign-off   — single-qual multi-pilot activity sign-off workflow
 *   Manage          — qual CRUD w/ classifier flags + completion deadline
 *
 * The hub itself is a thin shell; each sub-tab is its own component below.
 */

import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useMe } from '../App.jsx';
import MyQuals from './MyQuals.jsx';
import CurrencyStatus from './CurrencyStatus.jsx';
import BulkAssign from '../components/BulkAssign.jsx';
import BulkSignoff from '../components/BulkSignoff.jsx';
import ManageQuals from '../components/ManageQuals.jsx';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'my',       label: 'My Quals' },
  { key: 'currency', label: 'Currency' },
  { key: 'board',    label: 'Training Board' },
  { key: 'assign',   label: 'Bulk Assign', adminOnly: true },
  { key: 'signoff',  label: 'Bulk Sign-off', adminOnly: true },
  { key: 'manage',   label: 'Manage', adminOnly: true },
];

export default function Qualifications() {
  const { me, activeWing } = useMe();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'overview';
  const setTab = (k) => setParams({ tab: k });

  if (!activeWing) return <div className="empty">No wing yet.</div>;

  return (
    <div>
      <h1>Qualifications</h1>
      <p className="muted">Wing curriculum, currency, and your personal training.</p>

      <div className="card" style={{ padding: 6, marginBottom: 14 }}>
        <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
          {TABS.filter((t) => !t.adminOnly || me.isAdmin).map((t) => (
            <button key={t.key}
              className={`small ${tab === t.key ? 'primary' : ''}`}
              onClick={() => setTab(t.key)}>{t.label}</button>
          ))}
        </div>
      </div>

      {tab === 'overview' && <Overview wing={activeWing} />}
      {tab === 'my'       && <MyQuals />}
      {tab === 'currency' && <CurrencyStatus />}
      {tab === 'board'    && <BoardPicker wing={activeWing} />}
      {tab === 'assign'   && me.isAdmin && <BulkAssign wing={activeWing} />}
      {tab === 'signoff'  && me.isAdmin && <BulkSignoff wing={activeWing} />}
      {tab === 'manage'   && me.isAdmin && <ManageQuals wing={activeWing} />}
    </div>
  );
}

function Overview({ wing }) {
  const [quals, setQuals] = useState(null);
  useEffect(() => {
    api.get(`/api/quals?wing_id=${wing.id}`).then(setQuals);
  }, [wing.id]);
  if (!quals) return <p className="muted">Loading…</p>;
  if (!quals.length) return <div className="empty">No quals defined yet. Open the <b>Manage</b> tab to add some.</div>;
  return (
    <div className="card" style={{ padding: 0 }}>
      <table>
        <thead>
          <tr><th>Code</th><th>Name</th><th>Flags</th><th>Description</th></tr>
        </thead>
        <tbody>
          {quals.map((q) => (
            <tr key={q.id}>
              <td><b>{q.code}</b></td>
              <td>{q.name}</td>
              <td>
                {q.is_basic    ? <span className="badge cap" style={{ marginRight: 4 }}>Basic</span> : null}
                {q.is_currency ? <span className="badge cap" style={{ marginRight: 4 }}>Currency</span> : null}
                {q.is_tier     ? <span className="badge cap" style={{ marginRight: 4 }}>Tier</span> : null}
                {q.is_wing_wide ? null : <span className="badge cap" style={{ marginRight: 4 }}>Sqn-only</span>}
                {q.completion_deadline_days ? <span className="muted small" style={{ marginLeft: 4 }}>· {q.completion_deadline_days}d deadline</span> : null}
              </td>
              <td className="small muted">{q.description ? q.description.slice(0, 120) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BoardPicker({ wing }) {
  const [quals, setQuals] = useState([]);
  useEffect(() => { api.get(`/api/quals?wing_id=${wing.id}`).then(setQuals); }, [wing.id]);
  return (
    <div>
      <p className="muted">Pick a qualification to drop into its training-board matrix:</p>
      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        {quals.map((q) => (
          <Link key={q.id} to={`/training/${q.id}`} className="btn small">
            {q.code} <span className="muted small">· {q.name}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
