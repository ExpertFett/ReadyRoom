/**
 * Tiny hand-rolled SVG bar chart — no dependencies.
 *
 * Takes an array of { label, value, color? } and renders a horizontal-bar
 * (height-based) chart with axis ticks and value labels at the top of each
 * bar. Color defaults to the accent green. Used by the Metrics page for
 * attendance-over-time and day-of-week breakdowns.
 *
 * Designed for sparse-to-medium series (≤60 bars); above that the labels
 * get cramped. Bars auto-shrink to fit width.
 */

export function BarChart({ data, height = 200, valueFormat = (v) => `${v}%`, maxValue = 100, accent = '#4cd964' }) {
  if (!data || !data.length) return <div className="empty">No data.</div>;
  const max = Math.max(maxValue, ...data.map((d) => d.value));
  const padding = { top: 22, bottom: 36, left: 36, right: 8 };
  const w = 720;
  const innerW = w - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const barW = innerW / data.length;
  const gap = Math.min(4, barW * 0.18);
  const drawW = Math.max(1, barW - gap);

  // Y-axis ticks at 0%, 25%, 50%, 75%, 100% when value is a percentage
  const ticks = [0, 25, 50, 75, 100].filter((t) => t <= max);

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${w} ${height}`} style={{ width: '100%', height, minWidth: Math.min(w, data.length * 22) }}>
        {/* Y-axis grid + labels */}
        {ticks.map((t) => {
          const y = padding.top + innerH - (t / max) * innerH;
          return (
            <g key={t}>
              <line x1={padding.left} x2={padding.left + innerW} y1={y} y2={y} stroke="rgba(255,255,255,0.06)" />
              <text x={padding.left - 6} y={y + 3} textAnchor="end" fontSize="10" fill="rgba(255,255,255,0.45)">{t}</text>
            </g>
          );
        })}
        {/* Bars */}
        {data.map((d, i) => {
          const h = (d.value / max) * innerH;
          const x = padding.left + i * barW + gap / 2;
          const y = padding.top + innerH - h;
          const color = d.color || accent;
          return (
            <g key={i}>
              <rect x={x} y={y} width={drawW} height={h} fill={color} rx={1}>
                <title>{d.label}: {valueFormat(d.value)}</title>
              </rect>
              {/* value label above bar */}
              {drawW >= 22 && (
                <text x={x + drawW / 2} y={y - 4} textAnchor="middle" fontSize="9" fill="rgba(255,255,255,0.7)">
                  {valueFormat(d.value)}
                </text>
              )}
              {/* x-axis tick label */}
              {(data.length <= 24 || i % Math.ceil(data.length / 24) === 0) && (
                <text x={x + drawW / 2} y={padding.top + innerH + 14} textAnchor="middle" fontSize="10" fill="rgba(255,255,255,0.6)">
                  {d.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
