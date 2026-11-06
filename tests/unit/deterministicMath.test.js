import { describe, expect, it } from 'vitest'

const realSin = Math.sin
const realCos = Math.cos
const realAtan2 = Math.atan2

describe('deterministic math', () => {
  it('matches the platform to within rounding across a wide range', async () => {
    const { detSin, detCos, detAtan2 } = await import('../../src/physics/deterministicMath.js')
    let worst = 0
    for (let i = 0; i < 200000; i++) {
      const x = (i - 100000) * 0.00731
      worst = Math.max(worst, Math.abs(detSin(x) - realSin(x)), Math.abs(detCos(x) - realCos(x)))
    }
    expect(worst).toBeLessThan(1e-13)
    let worstAtan = 0
    for (let i = 0; i < 40000; i++) {
      const y = realSin(i * 0.37) * (1 + i * 0.01)
      const x = realCos(i * 0.91) * (1 + i * 0.003)
      worstAtan = Math.max(worstAtan, Math.abs(detAtan2(y, x) - realAtan2(y, x)))
    }
    expect(worstAtan).toBeLessThan(1e-13)
  })

  it('handles the axes and non-finite values', async () => {
    const { detSin, detCos, detAtan2 } = await import('../../src/physics/deterministicMath.js')
    expect(detSin(0)).toBe(0)
    expect(detCos(0)).toBe(1)
    expect(detSin(Infinity)).toBeNaN()
    expect(detCos(NaN)).toBeNaN()
    expect(detAtan2(0, 1)).toBe(0)
    expect(detAtan2(0, -1)).toBeCloseTo(Math.PI, 14)
    expect(detAtan2(1, 0)).toBeCloseTo(Math.PI / 2, 14)
    expect(detAtan2(-1, 0)).toBeCloseTo(-Math.PI / 2, 14)
    expect(detAtan2(-1, -1)).toBeCloseTo(-(3 * Math.PI) / 4, 14)
  })

  it('is installed before planck captures Math', async () => {
    await import('../../src/physics/PhysicsWorld.js')
    const { detSin } = await import('../../src/physics/deterministicMath.js')
    expect(Math.sin).toBe(detSin)
    const { Rot } = await import('planck')
    const rot = new Rot(1.234)
    expect(rot.s).toBe(detSin(1.234))
  })
})
