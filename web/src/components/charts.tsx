import { uz } from '../lib/uz'

/**
 * Deliberately small inline SVG charts — enough to read a trend at a glance,
 * with no charting dependency and no analytics beyond what the MVP needs.
 */

const AXIS = '#c6d3d8'
const LABEL = '#7c8f99'

export function AdherenceBarChart({ data }: {
  data: { date: string; rate: number | null; taken: number; total: number }[]
}) {
  if (data.length === 0) return <p className="muted small">{uz.reports.noData}</p>

  const width = Math.max(data.length * 54, 320)
  const height = 190
  const padBottom = 34
  const padTop = 12
  const plot = height - padBottom - padTop
  const barWidth = Math.min(30, (width / data.length) * 0.55)

  return (
    <div className="chart">
      <svg width={width} height={height} role="img" aria-label={uz.reports.adherenceByDay}>
        {[0, 50, 100].map((tick) => {
          const y = padTop + plot - (tick / 100) * plot
          return (
            <g key={tick}>
              <line x1={30} y1={y} x2={width} y2={y} stroke={AXIS} strokeDasharray={tick === 0 ? '0' : '3 4'} />
              <text x={0} y={y + 4} fontSize={10} fill={LABEL}>{tick}%</text>
            </g>
          )
        })}
        {data.map((day, index) => {
          const x = 34 + index * ((width - 40) / data.length)
          const rate = day.rate ?? 0
          const barHeight = (rate / 100) * plot
          const colour = day.rate === null ? '#dfe7ea' : rate >= 85 ? '#15803d' : rate >= 60 ? '#b45309' : '#be123c'
          return (
            <g key={day.date}>
              <title>{`${day.date}: ${day.rate === null ? uz.reports.noData : `${rate}% (${day.taken}/${day.total})`}`}</title>
              <rect
                x={x} y={padTop + plot - barHeight}
                width={barWidth} height={Math.max(barHeight, day.rate === null ? 2 : 3)}
                rx={4} fill={colour}
              />
              <text x={x + barWidth / 2} y={height - 16} fontSize={10} fill={LABEL} textAnchor="middle">
                {day.date.slice(8)}
              </text>
              <text x={x + barWidth / 2} y={height - 4} fontSize={9} fill={LABEL} textAnchor="middle">
                {day.date.slice(5, 7)}
              </text>
            </g>
          )
        })}
      </svg>
      <div className="chart__legend">
        <span className="chart__key"><span className="chart__swatch" style={{ background: '#15803d' }} /> 85%+</span>
        <span className="chart__key"><span className="chart__swatch" style={{ background: '#b45309' }} /> 60–84%</span>
        <span className="chart__key"><span className="chart__swatch" style={{ background: '#be123c' }} /> &lt;60%</span>
      </div>
    </div>
  )
}

export function GlucoseLineChart({ readings, low = 70, high = 180 }: {
  readings: { value: number; measured_at: string }[]
  low?: number
  high?: number
}) {
  if (readings.length < 2) return <p className="muted small">{uz.reports.noData}</p>

  const width = Math.max(readings.length * 22, 340)
  const height = 200
  const padTop = 12
  const padBottom = 26
  const padLeft = 34
  const plot = height - padTop - padBottom

  const values = readings.map((r) => r.value)
  const minValue = Math.min(...values, low - 20)
  const maxValue = Math.max(...values, high + 30)
  const span = maxValue - minValue || 1
  const toY = (value: number) => padTop + plot - ((value - minValue) / span) * plot
  const toX = (index: number) => padLeft + (index / (readings.length - 1)) * (width - padLeft - 8)

  const path = readings.map((r, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(r.value).toFixed(1)}`).join(' ')

  return (
    <div className="chart">
      <svg width={width} height={height} role="img" aria-label={uz.reports.glucoseEntries}>
        {/* The band between the patient's configured thresholds. */}
        <rect
          x={padLeft} y={toY(high)} width={width - padLeft - 8}
          height={Math.max(toY(low) - toY(high), 1)} fill="#eefbf2"
        />
        {[low, high].map((tick) => (
          <g key={tick}>
            <line x1={padLeft} y1={toY(tick)} x2={width - 8} y2={toY(tick)} stroke="#9fc7ae" strokeDasharray="4 4" />
            <text x={0} y={toY(tick) + 4} fontSize={10} fill={LABEL}>{tick}</text>
          </g>
        ))}
        <path d={path} fill="none" stroke="#0f766e" strokeWidth={2} strokeLinejoin="round" />
        {readings.map((r, i) => (
          <circle
            key={`${r.measured_at}-${i}`}
            cx={toX(i)} cy={toY(r.value)} r={3.2}
            fill={r.value > high || r.value < low ? '#be123c' : '#0f766e'}
          >
            <title>{`${r.measured_at}: ${r.value} mg/dL`}</title>
          </circle>
        ))}
        <text x={padLeft} y={height - 6} fontSize={10} fill={LABEL}>{readings[0].measured_at.slice(5, 10)}</text>
        <text x={width - 8} y={height - 6} fontSize={10} fill={LABEL} textAnchor="end">
          {readings[readings.length - 1].measured_at.slice(5, 10)}
        </text>
      </svg>
      <div className="chart__legend">
        <span className="chart__key"><span className="chart__swatch" style={{ background: '#eefbf2', border: '1px solid #9fc7ae' }} /> {low}–{high} mg/dL</span>
        <span className="chart__key"><span className="chart__swatch" style={{ background: '#be123c' }} /> Chegaradan tashqarida</span>
      </div>
    </div>
  )
}
