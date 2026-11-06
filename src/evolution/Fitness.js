// Fitness is whatever we choose to reward, and different choices evolve different
// animals. Every term is a physical measurement from SimulationStepper.

export const DEFAULT_WEIGHTS = Object.freeze({
  distance: 1,
  upright: 0.4, // metres-equivalent for staying upright the whole run
  drag: 0.75, // share of forward distance forfeited while the main body drags on the ground
  energy: 0.008, // per metre-equivalent of mechanical work: joules / (mass × gravity)
  invalid: 25, // subtracted from runs that broke a stability limit
})

// Without this term, toppling over and rowing along on the belly is the easiest thing to
// evolve, which scripts/filmstrip.mjs made plain. Backward motion is never discounted.
function credited(m, w) {
  return m.distance > 0 ? m.distance * (1 - w.drag * m.bodyDrag) : m.distance
}

export const OBJECTIVES = [
  {
    id: 'distance',
    name: 'forward distance',
    note: 'Rewards ending up far to the right. Distance earned while the main body drags along the ground counts for less, so sliding on the belly does not pay as well as using limbs.',
    score: (m, w) => w.distance * credited(m, w) + w.upright * m.upright - w.energy * m.energyNorm,
  },
  {
    id: 'speed',
    name: 'top speed',
    note: 'Scores the fastest three seconds of the run. Sprinters can collapse afterwards.',
    score: (m, w) => 6 * m.bestSpeed + 0.1 * w.distance * m.distance,
  },
  {
    id: 'efficient',
    name: 'energy efficiency',
    note: 'Distance per unit of mechanical work. Tends to discover low, shuffling gaits.',
    score: (m, w) => (m.distance > 0 ? (w.distance * m.distance) / (1 + 0.08 * m.energyNorm) : m.distance),
  },
  {
    id: 'upright',
    name: 'upright walking',
    note: 'Distance only counts for the fraction of time the body stays upright.',
    score: (m, w) => w.distance * m.distance * (0.1 + 0.9 * m.upright) + 1.5 * m.upright,
  },
  {
    id: 'jump',
    name: 'highest jump',
    note: 'Scores the peak height of the centre of mass above its starting height.',
    score: (m) => 5 * m.peakHeight + 0.05 * m.distance,
  },
]

export function getObjective(id) {
  return OBJECTIVES.find((objective) => objective.id === id) ?? OBJECTIVES[0]
}

export function computeFitness(metrics, objectiveId = 'distance', weights = DEFAULT_WEIGHTS) {
  const objective = getObjective(objectiveId)
  const w = { ...DEFAULT_WEIGHTS, ...weights }
  const score = objective.score(metrics, w)
  if (metrics.invalid) return Math.min(score, 0) - w.invalid
  return score
}
