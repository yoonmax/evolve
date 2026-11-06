// Produces the gallery's "evolved examples" by running the real genetic algorithm.
// A unit test re-simulates each one and checks that it still achieves its recorded result.
import { writeFileSync } from 'node:fs'
import { createPresets } from '../src/creatures/CreaturePresets.js'
import { Rng, hashSeed } from '../src/lib/rng.js'
import { breedNextGeneration, makeConfig, rankPopulation } from '../src/evolution/EvolutionEngine.js'
import { createInitialPopulation } from '../src/evolution/Population.js'
import { evaluateGenome } from '../src/evolution/evaluate.js'

const RECIPES = [
  { name: 'bounder', from: 'strider', seed: 11, gens: 90, env: 'flat', note: 'A strider that learned to bound.' },
  { name: 'galloper', from: 'trestle', seed: 12, gens: 90, env: 'flat', note: 'A trestle that found a rhythm.' },
  { name: 'skipper', from: 'pogo', seed: 13, gens: 90, env: 'flat', note: 'A pogo that keeps going.' },
  { name: 'looper', from: 'inchworm', seed: 14, gens: 90, env: 'flat', note: 'An inchworm that worked out which end is the front.' },
  { name: 'ridgeback', from: 'trestle', seed: 15, gens: 90, env: 'hills', note: 'A trestle evolved on uneven ground.' },
  { name: 'synapse', from: 'trestle', seed: 16, gens: 90, env: 'flat', controller: 'neural', note: 'Driven by a small neural network reading its own sensors.' },
]

const output = []
for (const recipe of RECIPES) {
  const ancestor = createPresets().find((genome) => genome.name === recipe.from)
  const config = makeConfig({ seed: recipe.seed, populationSize: 40, controller: recipe.controller ?? 'oscillator', env: { id: recipe.env, seed: 7 } })
  let population = createInitialPopulation(ancestor, config, new Rng(hashSeed(recipe.seed, 'founders')))
  let best = null
  for (let g = 1; g <= recipe.gens; g++) {
    for (const individual of population) {
      if (!individual.result) individual.result = evaluateGenome(individual.genome, config.env, config)
    }
    best = rankPopulation(population)[0]
    population = breedNextGeneration(population, config, g).population
  }
  const m = best.result.metrics
  console.log(recipe.name.padEnd(10), recipe.from.padEnd(9), `${m.distance.toFixed(2)} m`, `upright ${(m.upright * 100).toFixed(0)}%`, `drag ${(m.bodyDrag * 100).toFixed(0)}%`, m.invalid ?? '')
  output.push({
    ...best.genome,
    name: recipe.name,
    tagline: recipe.note,
    lineage: { from: recipe.from, generation: recipe.gens, seed: recipe.seed, env: recipe.env, population: 40, duration: config.duration, distance: m.distance, stateHash: m.stateHash },
  })
}
writeFileSync(new URL('../src/creatures/evolvedExamples.json', import.meta.url), `${JSON.stringify(output)}\n`)
