import { beforeEach, describe, expect, it } from 'vitest'
import { addSegment, blankCreature, childrenOf, descendantsOf, duplicateSegment, pointInSegment, removeSegment, reparentSegment, setShape } from '../../src/editor/SegmentTool.js'
import { localToAnchor, moveAttachment, moveJoint, resizeFromPoint, rotateTo, worldToLocal } from '../../src/editor/JointTool.js'
import { decodeGenome } from '../../src/creatures/GenomeDecoder.js'
import { repairGenome, validateGenome } from '../../src/creatures/GenomeValidator.js'
import { useEditor } from '../../src/state/editorStore.js'
import { MAX_SEGMENTS } from '../../src/physics/constants.js'
import { toNeural } from '../../src/evolution/Population.js'
import { Rng } from '../../src/lib/rng.js'

const fresh = () => repairGenome(blankCreature())

describe('body graph editing', () => {
  it('adds segments up to the limit', () => {
    const genome = fresh()
    while (genome.segments.length < MAX_SEGMENTS) expect(addSegment(genome, 0)).toBeGreaterThan(0)
    expect(addSegment(genome, 0)).toBe(-1)
    expect(validateGenome(genome)).toEqual([])
  })

  it('removes a segment with its subtree and keeps indices valid', () => {
    const genome = fresh()
    const child = addSegment(genome, 1)
    addSegment(genome, child)
    const before = genome.segments.length
    expect(removeSegment(genome, 1)).toBe(3)
    expect(genome.segments.length).toBe(before - 3)
    expect(validateGenome(genome)).toEqual([])
    genome.segments.forEach((segment, i) => expect(segment.id).toBe(`s${i}`))
  })

  it('will not remove the root', () => {
    const genome = fresh()
    expect(removeSegment(genome, 0)).toBe(0)
    expect(genome.segments.length).toBe(3)
  })

  it('duplicates a limb with its children, mirrored', () => {
    const genome = fresh()
    addSegment(genome, 1)
    const count = genome.segments.length
    const index = duplicateSegment(genome, 1)
    expect(index).toBe(count)
    expect(genome.segments.length).toBe(count + 2)
    expect(genome.segments[index].joint.anchorParent.u).toBeCloseTo(-genome.segments[1].joint.anchorParent.u, 9)
    expect(childrenOf(genome, index).length).toBe(1)
    expect(validateGenome(genome)).toEqual([])
  })

  it('reconnects segments while keeping a rooted tree', () => {
    const genome = fresh()
    const grand = addSegment(genome, 1)
    expect(reparentSegment(genome, 1, grand)).toBe(false) // would create a cycle
    expect(reparentSegment(genome, 2, 1)).toBe(true)
    expect(validateGenome(genome)).toEqual([])
    genome.segments.forEach((segment, i) => {
      if (i > 0) expect(segment.parent).toBeLessThan(i)
    })
    expect(descendantsOf(genome, 0).size).toBe(genome.segments.length - 1)
  })

  it('restores order when reconnecting forward', () => {
    const genome = fresh()
    const late = addSegment(genome, 0)
    expect(reparentSegment(genome, 1, late)).toBe(true)
    expect(validateGenome(genome)).toEqual([])
  })

  it('switches shape consistently', () => {
    const genome = fresh()
    setShape(genome.segments[1], 'circle')
    expect(genome.segments[1].h).toBe(genome.segments[1].w)
    expect(validateGenome(genome)).toEqual([])
    setShape(genome.segments[1], 'box')
    expect(validateGenome(genome)).toEqual([])
  })

  it('hit-tests shapes', () => {
    expect(pointInSegment({ shape: 'circle', w: 1, h: 1 }, 0.4, 0)).toBe(true)
    expect(pointInSegment({ shape: 'circle', w: 1, h: 1 }, 0.6, 0)).toBe(false)
    expect(pointInSegment({ shape: 'capsule', w: 1, h: 0.2 }, 0.45, 0)).toBe(true)
    expect(pointInSegment({ shape: 'capsule', w: 1, h: 0.2 }, 0, 0.2)).toBe(false)
    expect(pointInSegment({ shape: 'box', w: 1, h: 0.4 }, 0.49, 0.19)).toBe(true)
  })
})

describe('direct manipulation geometry', () => {
  it('converts between world and anchor coordinates', () => {
    const genome = fresh()
    const parts = decodeGenome(genome, { centered: false }).parts
    const local = worldToLocal(parts[0], 0.3, 0.1)
    expect(local.x).toBeCloseTo(0.3, 9)
    const anchor = localToAnchor(parts[0].segment, local)
    expect(anchor.u).toBeCloseTo(0.3 / 0.45, 9)
  })

  it('moving a limb slides its parent anchor', () => {
    const genome = fresh()
    const parts = decodeGenome(genome, { centered: false }).parts
    moveAttachment(genome, parts, 1, 0.2, 0.1, false)
    const moved = decodeGenome(genome, { centered: false }).parts[1]
    expect(moved.anchor.x).toBeCloseTo(0.2, 6)
    expect(moved.anchor.y).toBeCloseTo(0.1, 6)
  })

  it('moving a joint leaves the child where it was, within its extents', () => {
    const genome = fresh()
    const parts = decodeGenome(genome, { centered: false }).parts
    const before = { x: parts[1].x, y: parts[1].y }
    moveJoint(genome, parts, 1, parts[1].anchor.x, parts[1].anchor.y - 0.02, false)
    const after = decodeGenome(genome, { centered: false }).parts[1]
    expect(after.x).toBeCloseTo(before.x, 2)
    expect(after.y).toBeCloseTo(before.y, 2)
  })

  it('rotating sets the rest angle towards the pointer, with optional snapping', () => {
    const genome = fresh()
    const parts = decodeGenome(genome, { centered: false }).parts
    const pivot = parts[1].anchor
    rotateTo(genome, parts, 1, pivot.x + 1, pivot.y, false)
    expect(genome.segments[1].joint.rest).toBeCloseTo(0, 6)
    rotateTo(genome, parts, 1, pivot.x + 1, pivot.y + 0.31, true)
    expect(Math.abs(genome.segments[1].joint.rest / (Math.PI / 12) - Math.round(genome.segments[1].joint.rest / (Math.PI / 12)))).toBeLessThan(1e-9)
  })

  it('resizes within bounds', () => {
    const segment = { shape: 'capsule', w: 0.5, h: 0.1 }
    resizeFromPoint(segment, { x: 5, y: 0 }, 'length', false)
    expect(segment.w).toBe(1.8)
    resizeFromPoint(segment, { x: 0, y: 5 }, 'height', false)
    expect(segment.h).toBe(0.8)
    resizeFromPoint(segment, { x: 0.01, y: 0 }, 'length', false)
    expect(segment.w).toBeGreaterThanOrEqual(segment.h)
  })
})

describe('editor store', () => {
  beforeEach(() => useEditor.getState().load(fresh()))

  it('undoes and redoes', () => {
    const store = useEditor.getState()
    const original = store.genome.segments[0].w
    store.update((draft) => { draft.segments[0].w = 1 })
    expect(useEditor.getState().genome.segments[0].w).toBe(1)
    useEditor.getState().undo()
    expect(useEditor.getState().genome.segments[0].w).toBe(original)
    useEditor.getState().redo()
    expect(useEditor.getState().genome.segments[0].w).toBe(1)
  })

  it('merges a gesture into a single undo step', () => {
    const store = useEditor.getState()
    for (let i = 0; i < 20; i++) useEditor.getState().update((draft) => { draft.segments[0].w = 0.5 + i * 0.01 }, { key: 'drag' })
    expect(useEditor.getState().past.length).toBe(1)
    useEditor.getState().undo()
    expect(useEditor.getState().genome.segments[0].w).toBe(store.genome.segments[0].w)
  })

  it('clears redo after a new edit', () => {
    useEditor.getState().update((draft) => { draft.name = 'a' })
    useEditor.getState().undo()
    useEditor.getState().update((draft) => { draft.name = 'b' })
    expect(useEditor.getState().future.length).toBe(0)
  })

  it('reports problems for invalid creatures, so that they can be fixed', () => {
    useEditor.getState().update((draft) => { draft.segments[1].density = 0 })
    expect(useEditor.getState().problems.length).toBeGreaterThan(0)
    useEditor.getState().undo()
    expect(useEditor.getState().problems).toEqual([])
  })

  it('keeps neural weights matched to the body as it changes', () => {
    useEditor.getState().load(toNeural(fresh(), new Rng(1), 6))
    useEditor.getState().update((draft) => addSegment(draft, 0))
    expect(useEditor.getState().problems).toEqual([])
  })
})
