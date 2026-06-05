/**
 * Audit log viewer — admin-only.
 *
 * Lists every write recorded by logAction() in the API layer. Filterable by
 * entity type, actor, and date range. Default view: last 200 entries.
 *
 * Defense-in-depth complement to the multi-tenant guard: even with the
 * lockdown in place, the audit log tells you who did what — useful for
 * recovery after a leak and for general accountability.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useMe } from '../App.jsx';

const fmt = (ms) => (ms ? new Date(ms).toLocaleString([], { dateStyle: 'short', timeStyle: 'medium' }) : '—');

const ACTION_COLOR = {
  created:                '#4cd964',
  updated:                '#4c8bf5',
  deleted:                '#ff6464',
  regenerated:            '#ff9500',
  'bulk-assign':          '#8a63ff',
  'bulk-unassign':        '#ff9500',
  'bulk-instructor':      '#8a63ff',
  'bulk-signoff-signed':  '#4cd964',
  'bulk-signoff-reset':   '#ff9500',
  'bulk-signoff-instructor': '#8a63ff',
};

export default function AuditLog() {
  const { me, activeWing } = useMe();
  const [data, setData] = useState(null);
  const [filters, setFilters] = useState({ entity_type: '', actor_id: '', limit: 200 });

  const load = async () => {
    if (!activeWing) return;
    const q = new URLSearchParams();
    if (filters.entity_type) q.set('entity_type', filters.entity_type);
    if (filters.actor_id) q.set('actor_id', filters.actor_id);
    if (filters.limit) q.set('limit', filters.limit);
    setData(await api.get(`/api/wings/${activeWing.id}/audit-log?${q}`));
  };
  useEffect(() => { load(); }, [activeWing, filters]);

  if (!me.isAdmin) return <div className="empty">Admin-only.</div>;
  if (!activeWing) return <div className="empty">No wing yet.</div>;
  if (!data) return <p className="muted">Loading…</p>;

  return (
    <div>
      <h1>Audit log</h1>
      <p className="muted">Every admin write touches this log. Bookmark for accountability + leak investigation.</p>

      <div className="card" style={{ padding: 10, marginBottom: 12 }}>
        <div className="row" style={{ alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <label>Entity type
            <select value={filters.entity_type} onChange={(e) => setFilters({ ...filters, entity_type: e.target.value })}>
              <option value="">All types</option>
              {data.filters.entity_types.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label>Actor
            <select value={filters.actor_id} onChange={(e) => setFilters({ ...filters, actor_id: e.target.value })}>
              <option value="">All actors</option>
              {data.filters.actors.map((a) => <option key={a.actor_id} value={a.actor_id}>{a.actor_name || a.actor_id}</option>)}
            </select>
          </label>
          <label>Limit
            <select value={filters.limit} onChange={(e) => setFilters({ ...filters, limit: Number(e.target.value) })}>
              <option value="50">50</option>
              <option value="200">200</option>
              <option value="500">500</option>
              <option value="1000">1000</option>
            </select>
          </label>
          <span style={{ flex: 1 }} />
          <button className="small" onClick={load}>Refresh</button>
        </div>
      </div>

      {!data.entries.length ? <div className="empty">No entries match these filters.</div> : (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead><tr>
              <th>When</th><th>Actor</th><th>Action</th><th>Entity</th><th>Summary</th>
            </tr></thead>
            <tbody>
              {data.entries.map((e) => (
                <tr key={e.id}>
                  <td className="small mono">{fmt(e.created_at)}</td>
                  <td className="small">{e.actor_name || e.actor_id || <span className="muted">—</span>}</td>
                  <td><span className="badge" style={{
                    color: ACTION_COLOR[e.action] || 'var(--muted)',
                    borderColor: ACTION_COLOR[e.action] || 'var(--border)',
                  }}>{e.action}</span></td>
                  <td className="small">
                    <b>{e.entity_type}</b>
                    {e.entity_id != null && <span className="muted"> #{e.entity_id}</span>}
                  </td>
                  <td className="small">{e.summary || <span className="muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="muted small" style={{ marginTop: 10 }}>
        Showing {data.entries.length} {filters.entity_type ? `${filters.entity_type} ` : ''}entries.
        {data.entries.length >= filters.limit && <> Raise the limit to see more.</>}
      </p>
    </div>
  );
}
