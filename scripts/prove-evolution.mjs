// Headless evidence that selection produces locomotion: runs the real genetic algorithm
// on the real physics for every starter and prints what happened. No browser involved.
//   node scripts/prove-evolution.mjs [generations] [population] [seeds] [env] [controller]
import { createPresets } from '../src/creatures/CreaturePresets.js'
import { Rng, hashSeed } from '../src/lib/rng.js'
import { breedNextGeneration, makeConfig, rankPopulation } from '../src/evolution/EvolutionEngine.js'
import { createInitialPopulation } from '../src/evolution/Population.js'
import { evaluateGenome } from '../src/evolution/evaluate.js'

const [generations = 40, population = 30, seeds = 2, envId = 'flat', controller = 'oscillator', only = ''] = process.argv.slice(2)
const G = Number(generations)

function evaluateAll(pop, config) {
  for (const individual of pop) {
    if (!individual.result) individual.result = evaluateGenome(individual.genome, config.env, config)
  }
}

for (const ancestor of createPresets()) {
  if (only && ancestor.name !== only) continue
  const rows = []
  for (let seed = 1; seed <= Number(seeds); seed++) {
    const config = makeConfig({ seed, populationSize: Number(population), controller, env: { id: envId, seed: 7 } })
    let pop = createInitialPopulation(ancestor, config, new Rng(hashSeed(seed, 'founders')))
    const founderResult = evaluateGenome(pop[0].genome, config.env, config)
    const t0 = performance.now()
    const curve = []
    let best = null
    let bestEver = -Infinity
    for (let g = 0; g < G; g++) {
      evaluateAll(pop, config)
      const ranked = rankPopulation(pop)
      best = ranked[0]
      bestEver = Math.max(bestEver, best.result.fitness)
      curve.push(best.result.metrics.distance)
      pop = breedNextGeneration(pop, config, g).population
    }
    const ms = performance.now() - t0
    const m = best.result.metrics
    rows.push({
      seed,
      founder: founderResult.metrics.distance,
      first: curve[0],
      ten: curve[Math.min(9, G - 1)],
      final: m.distance,
      upright: m.upright,
      drag: m.bodyDrag,
      speed: m.bestSpeed,
      energy: m.energyNorm,
      invalid: m.invalid,
      ms,
      evals: G * Number(population),
      curve: curve.filter((_, i) => i % Math.max(1, Math.floor(G / 8)) === 0).map((d) => d.toFixed(1)).join(' '),
    })
  }
  for (const r of rows) {
    console.log(`${ancestor.name.padEnd(10)} seed ${r.seed}  founder ${r.founder.toFixed(2).padStart(6)} m  gen1 ${r.first.toFixed(2).padStart(6)}  gen10 ${r.ten.toFixed(2).padStart(6)}  gen${G} ${r.final.toFixed(2).padStart(6)} m  upright ${(r.upright * 100).toFixed(0).padStart(3)}%  drag ${(r.drag * 100).toFixed(0).padStart(3)}%  ${(r.ms / r.evals).toFixed(1)} ms/eval  [${r.curve}]${r.invalid ? ' INVALID ' + r.invalid : ''}`)
  }
}
