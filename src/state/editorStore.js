// The creature being edited, with undo history. Dragging a slider or a handle produces one
// undo step per gesture, not one per pixel.
import { create } from 'zustand'
import { cloneGenome } from '../creatures/Genome.js'
import { validateGenome, repairGenome } from '../creatures/GenomeValidator.js'
import { blankCreature } from '../editor/SegmentTool.js'
import { neuralWeightCount } from '../controllers/NeuralController.js'

const HISTORY_LIMIT = 100

export const useEditor = create((set, get) => ({
  genome: repairGenome(blankCreature()),
  selected: 0,
  past: [],
  future: [],
  problems: [],
  tool: 'select',
  snap: true,
  grid: true,
  gestureKey: null,
  gestureAt: 0,
  savedId: null,

  load(genome, { savedId = null } = {}) {
    set({ genome: cloneGenome(genome), past: [], future: [], selected: 0, problems: validateGenome(genome), tool: 'select', savedId })
  },

  /** @param key changes sharing a key within a short window merge into one undo step */
  update(recipe, { key = null } = {}) {
    const { genome, past, gestureKey, gestureAt } = get()
    const now = Date.now()
    const merging = key !== null && key === gestureKey && now - gestureAt < 800
    const draft = cloneGenome(genome)
    recipe(draft)
    syncNeuralSize(draft)
    set({
      genome: draft,
      past: merging ? past : [...past.slice(-HISTORY_LIMIT + 1), genome],
      future: [],
      problems: validateGenome(draft),
      gestureKey: key,
      gestureAt: now,
    })
  },

  undo() {
    const { past, genome, future, selected } = get()
    if (!past.length) return
    const previous = past[past.length - 1]
    set({
      genome: previous,
      past: past.slice(0, -1),
      future: [genome, ...future],
      problems: validateGenome(previous),
      selected: Math.min(selected ?? 0, previous.segments.length - 1),
      gestureKey: null,
    })
  },

  redo() {
    const { past, genome, future, selected } = get()
    if (!future.length) return
    const next = future[0]
    set({
      genome: next,
      past: [...past, genome],
      future: future.slice(1),
      problems: validateGenome(next),
      selected: Math.min(selected ?? 0, next.segments.length - 1),
      gestureKey: null,
    })
  },

  select(selected) {
    set({ selected })
  },
  setTool(tool) {
    set({ tool })
  },
  setSnap(snap) {
    set({ snap })
  },
  setGrid(grid) {
    set({ grid })
  },
  reset() {
    get().update((draft) => {
      const fresh = repairGenome(blankCreature())
      draft.segments = fresh.segments
      draft.rootAngle = 0
      draft.controller = fresh.controller
    })
    set({ selected: 0, savedId: null })
  },
  setSavedId(savedId) {
    set({ savedId })
  },
}))

function syncNeuralSize(genome) {
  const neural = genome.controller.neural
  if (genome.controller.type !== 'neural' || !neural) return
  const expected = neuralWeightCount(genome, neural.hidden)
  if (neural.weights.length !== expected) {
    neural.weights = Array.from({ length: expected }, (_, i) => neural.weights[i] ?? 0)
  }
}
