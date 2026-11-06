// ECMAScript leaves Math.sin, Math.cos and Math.atan2 implementation-defined, so two
// browsers may disagree in the last bit, and a chaotic contact simulation amplifies
// that into a different outcome. Basic double arithmetic is exact IEEE 754 everywhere,
// so these fdlibm ports return identical bits on every engine.
//
// planck captures Math.sin at module load, which is why this file must be imported
// first. It only ever runs in simulation workers and tests, never on the UI thread.

const S1 = -1.66666666666666324348e-1
const S2 = 8.33333333332248946124e-3
const S3 = -1.98412698298579493134e-4
const S4 = 2.75573137070700676789e-6
const S5 = -2.50507602534068634195e-8
const S6 = 1.58969099521155010221e-10
const C1 = 4.16666666666666019037e-2
const C2 = -1.38888888888741095749e-3
const C3 = 2.48015872894767294178e-5
const C4 = -2.75573143513906633035e-7
const C5 = 2.0875723212981748279e-9
const C6 = -1.13596475577881948265e-11

const INV_PIO2 = 6.36619772367581382433e-1
const PIO2_1 = 1.57079632673412561417
const PIO2_2 = 6.07710050630396597660e-11
const PIO2_2T = 2.02226624879595063154e-21

function kernelSin(x, y) {
  const z = x * x
  const v = z * x
  const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)))
  return x - (z * (0.5 * y - v * r) - y - v * S1)
}

function kernelCos(x, y) {
  const z = x * x
  const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))))
  const hz = 0.5 * z
  const w = 1 - hz
  return w + (1 - w - hz + (z * r - x * y))
}

let reducedHigh = 0
let reducedLow = 0

function reduce(x) {
  const n = Math.round(x * INV_PIO2)
  const t = x - n * PIO2_1
  let w = n * PIO2_2
  const r = t - w
  w = n * PIO2_2T - (t - r - w)
  reducedHigh = r - w
  reducedLow = r - reducedHigh - w
  return n & 3
}

export function detSin(x) {
  if (!Number.isFinite(x)) return NaN
  if (Math.abs(x) < 0.7853981633974483) return kernelSin(x, 0)
  const q = reduce(x)
  if (q === 0) return kernelSin(reducedHigh, reducedLow)
  if (q === 1) return kernelCos(reducedHigh, reducedLow)
  if (q === 2) return -kernelSin(reducedHigh, reducedLow)
  return -kernelCos(reducedHigh, reducedLow)
}

export function detCos(x) {
  if (!Number.isFinite(x)) return NaN
  if (Math.abs(x) < 0.7853981633974483) return kernelCos(x, 0)
  const q = reduce(x)
  if (q === 0) return kernelCos(reducedHigh, reducedLow)
  if (q === 1) return -kernelSin(reducedHigh, reducedLow)
  if (q === 2) return -kernelCos(reducedHigh, reducedLow)
  return kernelSin(reducedHigh, reducedLow)
}

const ATAN_HI = [4.63647609000806093515e-1, 7.85398163397448278999e-1, 9.82793723247329054082e-1, 1.570796326794896558]
const ATAN_LO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17]
const AT = [
  3.33333333333329318027e-1, -1.99999999998764832476e-1, 1.42857142725034663711e-1, -1.1111110405462355788e-1,
  9.09088713343650656196e-2, -7.69187620504482999495e-2, 6.66107313738753120669e-2, -5.83357013379057348645e-2,
  4.97687799461593236017e-2, -3.6531572744216915527e-2, 1.62858201153657823623e-2,
]

function atanPositive(x) {
  let id = -1
  let t = x
  if (x >= 0.4375) {
    if (x < 0.6875) {
      id = 0
      t = (2 * x - 1) / (2 + x)
    } else if (x < 1.1875) {
      id = 1
      t = (x - 1) / (x + 1)
    } else if (x < 2.4375) {
      id = 2
      t = (x - 1.5) / (1 + 1.5 * x)
    } else {
      id = 3
      t = -1 / x
    }
  }
  const z = t * t
  const w = z * z
  const s1 = z * (AT[0] + w * (AT[2] + w * (AT[4] + w * (AT[6] + w * (AT[8] + w * AT[10])))))
  const s2 = w * (AT[1] + w * (AT[3] + w * (AT[5] + w * (AT[7] + w * AT[9]))))
  if (id < 0) return t - t * (s1 + s2)
  return ATAN_HI[id] - (t * (s1 + s2) - ATAN_LO[id] - t)
}

const PI = 3.141592653589793

export function detAtan2(y, x) {
  if (Number.isNaN(x) || Number.isNaN(y)) return NaN
  if (y === 0) return x > 0 || Object.is(x, 0) ? y : Object.is(y, -0) ? -PI : PI
  if (x === 0) return y > 0 ? PI / 2 : -PI / 2
  const ratio = Math.abs(y / x)
  let angle
  if (!Number.isFinite(ratio)) angle = PI / 2
  else angle = ratio === 0 ? 0 : atanPositive(ratio)
  if (x < 0) angle = PI - angle
  return y < 0 ? -angle : angle
}

Math.sin = detSin
Math.cos = detCos
Math.atan2 = detAtan2
