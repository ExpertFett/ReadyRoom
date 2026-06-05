import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useMe } from '../App.jsx';
import { BarChart } from '../components/BarChart.jsx';

const DOW_ORDER = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const dayMs = 86400000;
const toIso = (ms) => new Date(ms).toISOString().slice(0, 10);

export default function Metrics() {
  const { activeWing } = useMe();
  const [range, setRange] = useState(() => ({
    from: toIso(Date.now() - 90 * dayMs),
    to: toIso(Date.now() + dayMs),
  }));
  const [metrics, setMetrics] = useState(null);
  const [perf, setPerf] = useState([]);
  const [series, setSeries] = useState([]);

  const load = async () => {
    if (!activeWing) return;
    const fromMs = new Date(range.from).getTime();
    const toMs = new Date(range.to).getTime();
    const [m, p, ts] = await Promise.all([
      api.get(`/api/wings/${activeWing.id}/attendance-metrics?from=${fromMs}&to=${toMs}`),
      api.get(`/api/wings/${activeWing.id}/pilot-performance?from=${fromMs}&to=${toMs}`),
      api.get(`/api/wings/${activeWing.id}/attendance-timeseries?from=${fromMs}&to=${toMs}`),
    ]);
    setMetrics(m); setPerf(p); setSeries(ts);
  };

  // Per-event chart data (one bar per tracked event in window)
  const eventChart = useMemo(() => series.map((e) => ({
    label: new Date(e.start_at).toLocaleDateString([], { month: 'numeric', day: 'numeric' }),
    value: e.attendance_rate,
    color: e.attendance_rate >= 75 ? '#4cd964' : e.attendance_rate >= 50 ? '#ffcc00' : '#ff6464',
  })), [series]);

  // Day-of-week breakdown — average attendance % per weekday across the window
  const dowChart = useMemo(() => {
    const sums = Object.fromEntries(DOW_ORDER.map((d) => [d, { total: 0, n: 0 }]));
    for (const e of series) {
      const d = DOW_ORDER[new Date(e.start_at).getDay()];
      sums[d].total += e.attendance_rate;
      sums[d].n += 1;
    }
    return DOW_ORDER.map((d) => {
      const avg = sums[d].n ? Math.round(sums[d].total / sums[d].n) : 0;
      return {
        label: d,
        value: avg,
        color: sums[d].n === 0 ? '#444' : avg >= 75 ? '#4cd964' : avg >= 50 ? '#ffcc00' : '#ff6464',
      };
    });
  }, [series]);
  useEffect(() => { load(); }, [range, activeWing]);

  const preset = (days) => () => setRange({ from: toIso(Date.now() - days * dayMs), to: toIso(Date.now() + dayMs) });

  if (!activeWing) return <div className="empty">No wing yet. <Link to="/wing">Set one up →</Link></div>;

  return (
    <div>
      <h1>Attendance metrics</h1>
      <p className="muted small">Across all tracked events in the selected date range.</p>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div><label>From</label><input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></div>
          <div><label>To</label><input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></div>
          <button className="small" onClick={preset(30)}>30d</button>
          <button className="small" onClick={preset(90)}>90d</button>
          <button className="small" onClick={preset(180)}>180d</button>
        </div>
      </div>

      {!metrics ? <p className="muted">Loading…</p> : (
        <div className="row" style={{ marginBottom: 16 }}>
          <Stat label="Attendance Rate" value={`${metrics.attendance_rate}%`} kind="good" sub={`${metrics.present} present + ${metrics.extra_credit} extra credit`} />
          <Stat label="Events Tracked" value={metrics.events_tracked} kind="info" sub={`${metrics.absent} absent rows total`} />
          <Stat label="Pilots Tracked" value={metrics.pilots_tracked} kind="info" sub="distinct pilots in window" />
          <Stat label="UA Instances" value={metrics.ua_instances} kind="warn" sub={`${metrics.excused} excused`} />
        </div>
      )}

      {series.length > 0 && (
        <>
          <h2>All Events <span className="muted small">({series.length} tracked)</span></h2>
          <div className="card" style={{ padding: 12, marginBottom: 14 }}>
            <BarChart data={eventChart} height={220} />
          </div>

          <h2>By Day of Week <span className="muted small">(average rate)</span></h2>
          <div className="card" style={{ padding: 12, marginBottom: 14 }}>
            <BarChart data={dowChart} height={180} />
          </div>
        </>
      )}

      <h2>Individual pilot performance</h2>
      {!perf.length ? <div className="empty">No attendance data in this window.</div> : (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead><tr><th>Pilot</th><th>Squadron</th><th>Events</th><th>Present</th><th>Extra Credit</th><th>Excused</th><th>UA</th><th>Rate</th><th>Accountability</th></tr></thead>
            <tbody>
              {perf.map((p) => (
                <tr key={p.member_id}>
                  <td><Link to={`/members/${p.member_id}`} className="callsign">{p.callsign || '—'}</Link>
                    {p.modex && <span className="muted small"> · {p.modex}</span>}</td>
                  <td className="small muted">{p.sqn_tag || '—'}</td>
                  <td>{p.events}</td>
                  <td className="small" style={{ color: 'var(--accent-2)' }}>{p.present}</td>
                  <td className="small">{p.extra_credit}</td>
                  <td className="small">{p.excused}</td>
                  <td className="small" style={{ color: p.ua > 0 ? 'var(--danger)' : 'var(--muted)' }}>{p.ua}</td>
                  <td><MeterBar pct={p.attendance_rate} kind={p.attendance_rate >= 80 ? 'good' : p.attendance_rate >= 50 ? 'warn' : 'bad'} /></td>
                  <td><MeterBar pct={p.accountability} kind={p.accountability >= 90 ? 'good' : 'warn'} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, kind, sub }) {
  return (
    <div className={`stat-card stat-${kind}`} style={{ flex: '1 1 200px' }}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub muted small">{sub}</div>}
    </div>
  );
}
function MeterBar({ pct, kind }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div className="qprog" style={{ width: 90 }}><span style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: kind === 'good' ? 'var(--accent-2)' : kind === 'warn' ? 'var(--warn)' : 'var(--danger)' }} /></div>
      <span className="small" style={{ minWidth: 42 }}>{pct}%</span>
    </div>
  );
}
