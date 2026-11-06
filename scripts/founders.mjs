// Measures what each starter does before any evolution. They are supposed to be bad.
import { createPresets } from '../src/creatures/CreaturePresets.js'
import { evaluateGenome } from '../src/evolution/evaluate.js'
for (const genome of createPresets()) {
  const { fitness, metrics: m } = evaluateGenome(genome, { id: 'flat', seed: 7 }, { duration: 12 })
  console.log(genome.name.padEnd(10), `distance ${m.distance.toFixed(2).padStart(6)} m`, `fitness ${fitness.toFixed(2).padStart(6)}`, `upright ${(m.upright * 100).toFixed(0).padStart(3)}%`, `drag ${(m.bodyDrag * 100).toFixed(0).padStart(3)}%`, `falls ${m.falls}`, `${genome.segments.length} parts`, m.invalid ?? '')
}
