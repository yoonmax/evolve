// Everything in the charts comes through here, derived from measured results only.
import { mean, median, quantile, stdev } from '../lib/math.js'
import { listGenes, topologySignature } from '../creatures/Genome.js'

/** Mean normalised distance of each genome to the population centroid. */
export function diversityProxy(genomes) {
  if (genomes.length < 2) return 0
  const buckets = new Map()
  for (const genome of genomes) {
    const key = topologySignature(genome)
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key).push(genome)
  }
  let total = 0
  let count = 0
  for (const group of buckets.values()) {
    if (group.length < 2) continue
    const vectors = group.map((genome) => listGenes(genome).map((gene) => (gene.holder[gene.field] - gene.min) / (gene.max - gene.min || 1)))
    const size = vectors[0].length
    const centroid = new Float64Array(size)
    for (const vector of vectors) for (let i = 0; i < size; i++) centroid[i] += vector[i] / vectors.length
    for (const vector of vectors) {
      let sum = 0
      for (let i = 0; i < size; i++) sum += (vector[i] - centroid[i]) ** 2
      total += Math.sqrt(sum / size)
      count++
    }
  }
  const structuralSpread = (buckets.size - 1) / Math.max(1, genomes.length - 1)
  return (count ? total / count : 0) + structuralSpread * 0.25
}

export function generationStats(ranked, generation, parentCount = 0) {
  const fitness = ranked.map((individual) => individual.result.fitness)
  const distances = ranked.map((individual) => individual.result.metrics.distance)
  const energies = ranked.map((individual) => individual.result.metrics.energyNorm)
  const invalid = ranked.filter((individual) => individual.result.metrics.invalid).length
  const best = ranked[0]
  return {
    generation,
    populationSize: ranked.length,
    bestFitness: fitness[0],
    meanFitness: mean(fitness),
    medianFitness: median(fitness),
    worstFitness: fitness[fitness.length - 1],
    fitnessStdev: stdev(fitness),
    q1Fitness: quantile(fitness, 0.25),
    q3Fitness: quantile(fitness, 0.75),
    bestDistance: Math.max(...distances),
    championDistance: best.result.metrics.distance,
    meanDistance: mean(distances),
    invalid,
    diversity: diversityProxy(ranked.map((individual) => individual.genome)),
    survivalRate: parentCount / ranked.length,
    fitness,
    distances,
    energies,
  }
}

export function summarizeForCsv(history) {
  const header = ['generation', 'seed', 'population', 'best_fitness', 'mean_fitness', 'median_fitness', 'best_distance_m', 'mean_distance_m', 'diversity', 'survival_rate', 'mutation_rate', 'invalid_runs', 'environment', 'controller']
  const rows = history.map((record) => [
    record.generation, record.seed, record.populationSize, record.bestFitness, record.meanFitness, record.medianFitness, record.bestDistance,
    record.meanDistance, record.diversity, record.survivalRate, record.mutationRate, record.invalid, record.envId, record.controller,
  ])
  return [header, ...rows].map((row) => row.join(',')).join('\n')
}
