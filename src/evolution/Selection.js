// Parent selection over a population that is already sorted, best first.

/** k individuals compete; the fittest of the sample wins. Larger k means harder selection. */
export function tournamentSelect(ranked, rng, size = 3) {
  let best = rng.int(ranked.length)
  for (let i = 1; i < size; i++) {
    const challenger = rng.int(ranked.length)
    if (challenger < best) best = challenger
  }
  return ranked[best]
}

/**
 * Linear ranking (Baker): expected offspring run from `pressure` for the best to
 * 2 - pressure for the worst, where pressure is in [1, 2].
 */
export function rankProbabilities(count, pressure = 1.7) {
  const s = Math.min(2, Math.max(1, pressure))
  const probabilities = new Float64Array(count)
  if (count === 1) {
    probabilities[0] = 1
    return probabilities
  }
  for (let i = 0; i < count; i++) {
    probabilities[i] = (s - (2 * (s - 1) * i) / (count - 1)) / count
  }
  return probabilities
}

export function rankSelect(ranked, rng, pressure = 1.7) {
  return sampleByProbability(ranked, rankProbabilities(ranked.length, pressure), rng)
}

/** Fitness-proportional, shifted so that the worst individual has a small positive share. */
export function rouletteProbabilities(ranked) {
  const values = ranked.map((individual) => individual.result?.fitness ?? 0)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const floor = (max - min) * 0.02 + 1e-9
  const shifted = values.map((value) => value - min + floor)
  const total = shifted.reduce((sum, value) => sum + value, 0)
  return Float64Array.from(shifted, (value) => value / total)
}

export function rouletteSelect(ranked, rng) {
  return sampleByProbability(ranked, rouletteProbabilities(ranked), rng)
}

function sampleByProbability(items, probabilities, rng) {
  let threshold = rng.next()
  for (let i = 0; i < items.length; i++) {
    threshold -= probabilities[i]
    if (threshold <= 0) return items[i]
  }
  return items[items.length - 1]
}

export const SELECTION_METHODS = [
  { id: 'tournament', name: 'tournament', note: 'Pick a few at random; the fittest becomes a parent.' },
  { id: 'rank', name: 'rank-based', note: 'Chance of parenthood depends on rank, not on score.' },
  { id: 'roulette', name: 'roulette wheel', note: 'Chance of parenthood is proportional to score.' },
]

export function selectParent(ranked, rng, selection = {}) {
  switch (selection.method) {
    case 'rank':
      return rankSelect(ranked, rng, selection.rankPressure)
    case 'roulette':
      return rouletteSelect(ranked, rng)
    default:
      return tournamentSelect(ranked, rng, selection.tournamentSize ?? 3)
  }
}
