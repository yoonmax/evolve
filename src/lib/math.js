export const TAU = Math.PI * 2

export const clamp = (value, min, max) => (value < min ? min : value > max ? max : value)

export const lerp = (a, b, t) => a + (b - a) * t

/** Wraps an angle into [-PI, PI). */
export function wrapAngle(angle) {
  let a = (angle + Math.PI) % TAU
  if (a < 0) a += TAU
  return a - Math.PI
}

/** Shortest-path angle interpolation. */
export function lerpAngle(a, b, t) {
  return a + wrapAngle(b - a) * t
}

export function mean(values) {
  if (!values.length) return 0
  let sum = 0
  for (const value of values) sum += value
  return sum / values.length
}

export function median(values) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export function stdev(values) {
  if (values.length < 2) return 0
  const m = mean(values)
  let sum = 0
  for (const value of values) sum += (value - m) ** 2
  return Math.sqrt(sum / (values.length - 1))
}

export function quantile(values, q) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const position = (sorted.length - 1) * q
  const base = Math.floor(position)
  const rest = position - base
  return sorted[base + 1] !== undefined ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base]
}
