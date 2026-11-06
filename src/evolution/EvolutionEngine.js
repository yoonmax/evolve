// One generation step: rank, keep elites, select parents, recombine, mutate. Pure given
// the evaluated population, the config and the generation number; all randomness comes
// from a generator seeded by (experiment seed, generation).
import { Rng, hashSeed } from '../lib/rng.js'
import { cloneGenome } from '../creatures/Genome.js'
import { crossover } from './Crossover.js'
import { mutateGenome, DEFAULT_MUTATION } from './Mutation.js'
import { createIndividual } from './Population.js'
import { selectParent } from './Selection.js'
import { DEFAULT_WEIGHTS } from './Fitness.js'
import { DEFAULT_ENV } from '../physics/Environments.js'

export const DEFAULT_CONFIG = Object.freeze({
  seed: 1,
  populationSize: 30,
  elites: 2,
  selection: { method: 'tournament', tournamentSize: 3, rankPressure: 1.7 },
  crossoverRate: 0.5,
  mutation: { ...DEFAULT_MUTATION },
  objective: 'distance',
  weights: { ...DEFAULT_WEIGHTS },
  duration: 12,
  trials: 1,
  controller: 'oscillator',
  hidden: 8,
  env: { ...DEFAULT_ENV },
})

export const POPULATION_LIMITS = [4, 200]

export function makeConfig(overrides = {}) {
  return {
    ...DEFAULT_CONFIG,
    ...overrides,
    selection: { ...DEFAULT_CONFIG.selection, ...overrides.selection },
    mutation: { ...DEFAULT_CONFIG.mutation, ...overrides.mutation },
    weights: { ...DEFAULT_CONFIG.weights, ...overrides.weights },
    env: { ...DEFAULT_CONFIG.env, ...overrides.env },
  }
}

export function generationSeed(config, generation) {
  return hashSeed(config.seed, 'generation', generation)
}

/** Sorted best first, stable on ties, so the ranking never depends on arrival order. */
export function rankPopulation(population) {
  return population
    .map((individual, index) => ({ individual, index }))
    .sort((a, b) => b.individual.result.fitness - a.individual.result.fitness || a.index - b.index)
    .map(({ individual }) => individual)
}

/**
 * @returns {population, parentIds} the next generation. Elites are exact copies with
 * their measured result attached, so they do not need evaluating again and can never
 * pick up a mutation by accident.
 */
export function breedNextGeneration(evaluated, config, generation) {
  const rng = new Rng(generationSeed(config, generation))
  const ranked = rankPopulation(evaluated)
  const next = []
  const parentIds = new Set()
  const eliteCount = Math.min(config.elites, ranked.length, config.populationSize)
  for (let i = 0; i < eliteCount; i++) {
    const elite = createIndividual(cloneGenome(ranked[i].genome), 'elite', [ranked[i].id])
    elite.result = ranked[i].result
    elite.parentGenome = ranked[i].parentGenome ?? null
    parentIds.add(ranked[i].id)
    next.push(elite)
  }
  while (next.length < config.populationSize) {
    const first = selectParent(ranked, rng, config.selection)
    parentIds.add(first.id)
    let genome = null
    let origin = 'mutant'
    const parents = [first.id]
    if (rng.bool(config.crossoverRate)) {
      const second = selectParent(ranked, rng, config.selection)
      const recombined = second === first ? null : crossover(first.genome, second.genome, rng)
      if (recombined) {
        genome = recombined
        origin = 'cross'
        parents.push(second.id)
        parentIds.add(second.id)
      }
    }
    const child = mutateGenome(genome ?? first.genome, config.mutation, rng)
    const offspring = createIndividual(child, origin, parents)
    offspring.parentGenome = first.genome
    next.push(offspring)
  }
  return { population: next, parentIds }
}
