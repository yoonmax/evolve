// Minimal SVG charts. All of them plot measured values and report the value under the
// pointer in their subtitle; a text table of the same data sits beside them on the page.
import { useId, useState } from 'react'

const W = 520
const H = 190
const M = { left: 40, right: 12, top: 10, bottom: 24 }

export function niceTicks(min, max, count = 4) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0]
  if (min === max) return [min]
  const span = max - min
  const step0 = span / count
  const power = 10 ** Math.floor(Math.log10(step0))
  const candidates = [1, 2, 2.5, 5, 10].map((m) => m * power)
  const step = candidates.find((candidate) => span / candidate <= count + 0.5) ?? step0
  const ticks = []
  for (let value = Math.ceil(min / step) * step; value <= max + step * 0.001; value += step) ticks.push(Number(value.toFixed(8)))
  return ticks
}

const short = (value) => {
  const size = Math.abs(value)
  if (size >= 1000) return `${(value / 1000).toFixed(1)}k`
  if (size >= 10 || size === 0) return value.toFixed(0)
  if (size >= 1) return value.toFixed(1)
  return value.toFixed(2)
}

export function LineChart({ title, description, series, generations, onSelect, selected, unit = '', band = null, height = H }) {
  const [hover, setHover] = useState(null)
  const clip = useId()
  const n = generations.length
  const all = series.flatMap((item) => item.values).filter(Number.isFinite)
  const bandValues = band ? [...band.low, ...band.high].filter(Number.isFinite) : []
  const rawMin = Math.min(0, ...all, ...bandValues)
  const rawMax = Math.max(...all, ...bandValues, 0.01)
  const pad = (rawMax - rawMin) * 0.06
  const min = rawMin - (rawMin < 0 ? pad : 0)
  const max = rawMax + pad
  const xAt = (i) => M.left + (n > 1 ? (i / (n - 1)) * (W - M.left - M.right) : 0)
  const yAt = (value) => M.top + (1 - (value - min) / (max - min || 1)) * (height - M.top - M.bottom)
  const pathOf = (values) => values.map((value, i) => `${i ? 'L' : 'M'}${xAt(i).toFixed(1)} ${yAt(value).toFixed(1)}`).join('')
  const yTicks = niceTicks(min, max)
  const xStep = Math.max(1, Math.ceil(n / 6))

  const indexFromEvent = (event) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = ((event.clientX - rect.left) / rect.width) * W
    const i = Math.round(((x - M.left) / (W - M.left - M.right)) * (n - 1))
    return Math.max(0, Math.min(n - 1, i))
  }
  const active = hover ?? (selected !== null && selected !== undefined ? generations.indexOf(selected) : -1)

  return (
    <figure className="chart" style={{ margin: 0 }}>
      <h3>{title}</h3>
      <p className="chart-sub">
        {active >= 0 && n
          ? `generation ${generations[active]}: ${series.map((item) => `${item.name} ${Number.isFinite(item.values[active]) ? item.values[active].toFixed(2) : '–'}${unit}`).join(', ')}`
          : description}
      </p>
      {n ? (
        <svg
          viewBox={`0 0 ${W} ${height}`}
          role="img"
          aria-label={`${title}. Latest: ${series.map((item) => `${item.name} ${item.values[n - 1]?.toFixed(2)}${unit}`).join(', ')}.`}
          onPointerMove={(event) => setHover(indexFromEvent(event))}
          onPointerLeave={() => setHover(null)}
          onClick={(event) => onSelect?.(generations[indexFromEvent(event)])}
          style={{ cursor: onSelect ? 'pointer' : 'default', touchAction: 'pan-y' }}
        >
          <clipPath id={clip}><rect x={M.left} y={0} width={W - M.left - M.right + 2} height={height} /></clipPath>
          {yTicks.map((tick) => (
            <g key={tick}>
              <line className="grid" x1={M.left} x2={W - M.right} y1={yAt(tick)} y2={yAt(tick)} />
              <text x={M.left - 6} y={yAt(tick) + 4} textAnchor="end">{short(tick)}</text>
            </g>
          ))}
          {generations.map((generation, i) => (i % xStep === 0 ? <text key={generation} x={xAt(i)} y={height - 7} textAnchor="middle">{generation}</text> : null))}
          <g clipPath={`url(#${clip})`}>
            {band ? <path d={`${pathOf(band.high)}${band.low.map((value, i) => `L${xAt(band.low.length - 1 - i).toFixed(1)} ${yAt(band.low[band.low.length - 1 - i]).toFixed(1)}`).join('')}Z`} fill={band.color} opacity={0.35} /> : null}
            {series.map((item) => (
              <path key={item.name} d={pathOf(item.values)} fill="none" stroke={item.color} strokeWidth={item.width ?? 2} strokeLinejoin="round" strokeLinecap="round" />
            ))}
            {active >= 0 ? <line x1={xAt(active)} x2={xAt(active)} y1={M.top} y2={height - M.bottom} stroke="var(--ink-soft)" strokeWidth="1" strokeDasharray="3 3" /> : null}
            {active >= 0 ? series.map((item) => (Number.isFinite(item.values[active]) ? <circle key={item.name} cx={xAt(active)} cy={yAt(item.values[active])} r={3.5} fill={item.color} stroke="var(--paper)" strokeWidth="1.5" /> : null)) : null}
          </g>
        </svg>
      ) : <div className="empty">No generations yet.</div>}
      {series.length > 1 ? (
        <div className="legend">{series.map((item) => <span key={item.name}><i style={{ background: item.color }} />{item.name}</span>)}</div>
      ) : null}
    </figure>
  )
}

export function Histogram({ title, description, values, unit = '', bins = 14, compare = null, valueLabel, compareLabel }) {
  const [hover, setHover] = useState(null)
  if (!values?.length) return <figure className="chart" style={{ margin: 0 }}><h3>{title}</h3><div className="empty">No data for this generation.</div></figure>
  const pool = compare?.length ? [...values, ...compare] : values
  const min = Math.min(...pool)
  const max = Math.max(...pool)
  const width = (max - min || 1) / bins
  const tally = (list) => {
    const counts = new Array(bins).fill(0)
    for (const value of list) counts[Math.min(bins - 1, Math.floor((value - min) / width))]++
    return counts
  }
  const counts = tally(values)
  const baseline = compare?.length ? tally(compare) : null
  const top = Math.max(...counts, ...(baseline ?? []))
  const innerW = W - M.left - M.right
  const barW = innerW / bins
  const yAt = (count) => M.top + (1 - count / top) * (H - M.top - M.bottom)
  return (
    <figure className="chart" style={{ margin: 0 }}>
      <h3>{title}</h3>
      <p className="chart-sub">{hover !== null ? `${(min + hover * width).toFixed(2)} to ${(min + (hover + 1) * width).toFixed(2)}${unit}: ${counts[hover]} creatures` : description}</p>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}: ${values.length} values from ${min.toFixed(2)} to ${max.toFixed(2)}${unit}.`} onPointerLeave={() => setHover(null)}>
        <line className="axis" x1={M.left} x2={W - M.right} y1={H - M.bottom} y2={H - M.bottom} />
        {counts.map((count, i) => (
          <rect key={i} x={M.left + i * barW + 1} y={yAt(count)} width={Math.max(1, barW - 2)} height={H - M.bottom - yAt(count)} rx={2} fill={hover === i ? 'var(--accent)' : 'var(--ink)'} onPointerEnter={() => setHover(i)} />
        ))}
        {baseline ? (
          <path
            d={baseline.map((count, i) => `${i ? 'L' : 'M'}${(M.left + i * barW).toFixed(1)} ${yAt(count).toFixed(1)}L${(M.left + (i + 1) * barW).toFixed(1)} ${yAt(count).toFixed(1)}`).join('')}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="2"
            strokeLinejoin="round"
          />
        ) : null}
        <text x={M.left} y={H - 7} textAnchor="start">{min.toFixed(1)}{unit}</text>
        <text x={W - M.right} y={H - 7} textAnchor="end">{max.toFixed(1)}{unit}</text>
        <text x={M.left - 6} y={yAt(top) + 4} textAnchor="end">{top}</text>
        <text x={M.left - 6} y={H - M.bottom + 4} textAnchor="end">0</text>
      </svg>
      {baseline ? <div className="legend"><span><i style={{ background: 'var(--ink)', height: 8, width: 8, borderRadius: 2 }} />{valueLabel}</span><span><i style={{ background: 'var(--accent)' }} />{compareLabel}</span></div> : null}
    </figure>
  )
}

export function Scatter({ title, description, xs, ys, xLabel, yLabel, highlight = 0 }) {
  const [hover, setHover] = useState(null)
  if (!xs?.length) return <figure className="chart" style={{ margin: 0 }}><h3>{title}</h3><div className="empty">No data for this generation.</div></figure>
  const xMin = Math.min(0, ...xs)
  const xMax = Math.max(0.01, ...xs)
  const yMin = Math.min(0, ...ys)
  const yMax = Math.max(0.01, ...ys)
  const xAt = (value) => M.left + ((value - xMin) / (xMax - xMin || 1)) * (W - M.left - M.right)
  const yAt = (value) => M.top + (1 - (value - yMin) / (yMax - yMin || 1)) * (H - M.top - M.bottom)
  return (
    <figure className="chart" style={{ margin: 0 }}>
      <h3>{title}</h3>
      <p className="chart-sub">{hover !== null ? `${xLabel} ${xs[hover].toFixed(2)}, ${yLabel} ${ys[hover].toFixed(2)}` : description}</p>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title} for ${xs.length} creatures.`} onPointerLeave={() => setHover(null)}>
        {niceTicks(yMin, yMax).map((tick) => (
          <g key={tick}>
            <line className="grid" x1={M.left} x2={W - M.right} y1={yAt(tick)} y2={yAt(tick)} />
            <text x={M.left - 6} y={yAt(tick) + 4} textAnchor="end">{short(tick)}</text>
          </g>
        ))}
        {niceTicks(xMin, xMax).map((tick) => <text key={tick} x={xAt(tick)} y={H - 7} textAnchor="middle">{short(tick)}</text>)}
        {xs.map((x, i) => (
          <circle key={i} cx={xAt(x)} cy={yAt(ys[i])} r={i === highlight ? 5 : 3.5} fill={i === highlight ? 'var(--accent)' : 'var(--ink)'} opacity={i === highlight ? 1 : 0.5} onPointerEnter={() => setHover(i)} />
        ))}
      </svg>
      <div className="legend"><span>across: {xLabel}</span><span>up: {yLabel}</span><span><i style={{ background: 'var(--accent)', height: 8, width: 8, borderRadius: 4 }} />best</span></div>
    </figure>
  )
}
