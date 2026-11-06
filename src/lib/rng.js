// Seeded randomness. Every stochastic decision in the application draws from one
// of these so that an experiment can be reproduced from its seed.

/** Mixes any number of integers and strings into a 32-bit seed (FNV-1a). */
export function hashSeed(...parts) {
  let h = 0x811c9dc5
  for (const part of parts) {
    const text = String(part)
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i)
      h = Math.imul(h, 0x01000193)
    }
    h ^= 0x7c
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export class Rng {
  constructor(seed = 1) {
    this.state = seed >>> 0
    this.spare = null
  }

  /** mulberry32: uniform in [0, 1). */
  next() {
    this.state = (this.state + 0x6d2b79f5) >>> 0
    let t = this.state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  range(min, max) {
    return min + (max - min) * this.next()
  }

  /** Integer in [0, n). */
  int(n) {
    return Math.floor(this.next() * n)
  }

  bool(probability = 0.5) {
    return this.next() < probability
  }

  pick(items) {
    return items[this.int(items.length)]
  }

  /** Standard normal, Marsaglia polar method. Pure arithmetic, so portable across engines. */
  gauss() {
    if (this.spare !== null) {
      const value = this.spare
      this.spare = null
      return value
    }
    let u, v, s
    do {
      u = 2 * this.next() - 1
      v = 2 * this.next() - 1
      s = u * u + v * v
    } while (s >= 1 || s === 0)
    const scale = Math.sqrt((-2 * logApprox(s)) / s)
    this.spare = v * scale
    return u * scale
  }

  fork(label) {
    return new Rng(hashSeed(this.state, label))
  }
}

// Math.log is implementation-defined in ECMAScript, and a reproducible experiment
// cannot depend on it. Series on the reduced mantissa is plenty for sampling noise.
function logApprox(x) {
  let exponent = 0
  let m = x
  while (m < 0.75) {
    m *= 2
    exponent--
  }
  while (m > 1.5) {
    m /= 2
    exponent++
  }
  const r = (m - 1) / (m + 1)
  const r2 = r * r
  const series = r * (2 + r2 * (2 / 3 + r2 * (2 / 5 + r2 * (2 / 7 + r2 * (2 / 9 + r2 * (2 / 11))))))
  return exponent * 0.6931471805599453 + series
}

export function randomSeed() {
  const values = new Uint32Array(1)
  crypto.getRandomValues(values)
  return values[0]
}
