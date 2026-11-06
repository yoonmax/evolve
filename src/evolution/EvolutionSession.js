// A running experiment: population, history, and the loop that drives them. Knows nothing
// about React or the canvas; the UI subscribes to it and supplies a pacing gate.
import { Rng, hashSeed, randomSeed } from '../lib/rng.js'
import { cloneGenome } from '../creatures/Genome.js'
import { breedNextGeneration, generationSeed, makeConfig, rankPopulation } from './EvolutionEngine.js'
import { createIndividual, createInitialPopulation } from './Population.js'
import { evaluatePopulation } from './EvaluationManager.js'
import { generationStats } from '../statistics/StatisticsEngine.js'
import { CancelledError } from '../workers/WorkerPool.js'
import { mutateGenome } from './Mutation.js'

const MAX_HISTORY_DETAIL = 400 // generations that keep every individual's score

export class EvolutionSession {
  constructor({ id, name, ancestor, config, pool, evaluator }) {
    this.id = id ?? `exp-${Date.now().toString(36)}-${(randomSeed() % 46656).toString(36)}`
    this.name = name ?? `${ancestor?.name ?? 'creature'} experiment`
    this.createdAt = Date.now()
    this.config = makeConfig(config)
    this.ancestor = ancestor ? cloneGenome(ancestor) : null
    this.pool = pool
    this.evaluator = evaluator ?? ((population, cfg, options) => evaluatePopulation(population, cfg, pool, options))
    this.generation = 1 // the generation currently being (or next to be) evaluated
    this.history = []
    this.population = ancestor ? createInitialPopulation(this.ancestor, this.config, new Rng(hashSeed(this.config.seed, 'founders'))) : []
    this.running = false
    this.busy = false
    this.limit = Infinity
    this.gate = null
    this.listeners = new Set()
    this.group = `session-${this.id}`
    this.startedAt = 0
    this.evaluations = 0
    this.evaluationMs = 0
  }

  subscribe(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(event) {
    for (const listener of this.listeners) listener(event, this)
  }

  /** Evaluates the current generation and breeds the next. Resolves with its record. */
  async stepGeneration() {
    if (this.busy) throw new Error('This generation is already being evaluated.')
    this.busy = true
    const generation = this.generation
    const seed = generationSeed(this.config, generation)
    const pendingBefore = this.population.filter((individual) => !individual.result).length
    const t0 = now()
    try {
      this.emit({ type: 'evaluating', generation, done: 0, total: pendingBefore })
      const { failures } = await this.evaluator(this.population, this.config, {
        group: this.group,
        onProgress: (done, total) => this.emit({ type: 'evaluating', generation, done, total }),
      })
      const ms = now() - t0
      this.evaluations += pendingBefore
      this.evaluationMs += ms
      const ranked = rankPopulation(this.population)
      const { population: next, parentIds } = breedNextGeneration(this.population, this.config, generation)
      const stats = generationStats(ranked, generation, parentIds.size)
      const record = {
        ...stats,
        seed,
        bestGenome: cloneGenome(ranked[0].genome),
        bestMetrics: ranked[0].result.metrics,
        parentGenome: ranked[0].parentGenome ?? null,
        medianGenome: ranked[ranked.length >> 1].genome,
        envId: this.config.env.id,
        env: { ...this.config.env },
        controller: this.config.controller,
        mutationRate: this.config.mutation.rate,
        mutationStrength: this.config.mutation.strength,
        objective: this.config.objective,
        duration: this.config.duration,
        evaluationMs: ms,
        failures,
        ranked: ranked.slice(0, 16).map((individual) => ({ genome: individual.genome, fitness: individual.result.fitness, metrics: individual.result.metrics, origin: individual.origin })),
      }
      this.pruneHistory()
      this.history.push(record)
      this.population = next
      this.generation = generation + 1
      this.emit({ type: 'generation', record })
      return record
    } finally {
      this.busy = false
    }
  }

  /** Older generations keep their champion and summary but drop per-individual detail. */
  pruneHistory() {
    const cut = this.history.length - MAX_HISTORY_DETAIL
    if (cut >= 0) {
      const old = this.history[cut]
      if (old) {
        old.fitness = null
        old.distances = null
        old.energies = null
      }
    }
    for (let i = Math.max(0, this.history.length - 40); i < this.history.length - 4; i++) {
      // Only the most recent generations need their top creatures for population view.
      const record = this.history[i]
      if (record && record.ranked && record.ranked.length > 2) record.ranked = record.ranked.slice(0, 2)
      if (record) {
        record.parentGenome = null
        record.medianGenome = null
      }
    }
  }

  /** Keeps evolving until stop() or the generation limit. */
  async run({ limit = Infinity } = {}) {
    if (this.running) return
    this.running = true
    this.limit = limit
    this.emit({ type: 'status', running: true })
    try {
      while (this.running && this.generation <= this.limit) {
        const record = await this.stepGeneration()
        if (this.gate && this.running) await this.gate(record)
      }
    } catch (error) {
      if (!(error instanceof CancelledError)) {
        this.emit({ type: 'error', error })
      }
    } finally {
      this.running = false
      this.emit({ type: 'status', running: false })
    }
  }

  stop() {
    this.running = false
    this.gateRelease?.()
  }

  /** Stop immediately, abandoning the generation in progress. */
  cancel() {
    this.running = false
    this.pool?.cancelGroup(this.group)
    this.gateRelease?.()
  }

  dispose() {
    this.cancel()
    this.listeners.clear()
  }

  /** Changes settings for all later generations. Earlier records stay as they were. */
  updateConfig(partial) {
    const envChanged = partial.env && partial.env.id !== this.config.env.id
    const objectiveChanged = partial.objective && partial.objective !== this.config.objective
    const durationChanged = partial.duration && partial.duration !== this.config.duration
    const weightsChanged = Boolean(partial.weights)
    this.config = makeConfig({ ...this.config, ...partial })
    if (envChanged || objectiveChanged || durationChanged || weightsChanged || partial.trials) {
      // The old scores measured something else: elites must prove themselves again.
      for (const individual of this.population) individual.result = null
    }
    if (partial.populationSize) this.resizePopulation()
  }

  resizePopulation() {
    const size = this.config.populationSize
    if (this.population.length > size) {
      this.population = this.population.slice(0, size)
      return
    }
    const rng = new Rng(hashSeed(this.config.seed, 'resize', this.generation))
    const count = this.population.length
    while (this.population.length < size) {
      const parent = this.population[this.population.length % count]
      this.population.push(createIndividual(mutateGenome(parent.genome, this.config.mutation, rng), 'mutant', [parent.id]))
    }
  }

  // Checkpoints: everything needed to continue, with no physics frames.
  toCheckpoint() {
    return {
      id: this.id,
      name: this.name,
      createdAt: this.createdAt,
      updatedAt: Date.now(),
      config: this.config,
      ancestor: this.ancestor,
      generation: this.generation,
      population: this.population.map((individual) => ({ genome: individual.genome, origin: individual.origin, result: individual.result })),
    }
  }

  static fromCheckpoint(checkpoint, history, { pool, evaluator } = {}) {
    const session = new EvolutionSession({ id: checkpoint.id, name: checkpoint.name, ancestor: null, config: checkpoint.config, pool, evaluator })
    session.createdAt = checkpoint.createdAt ?? Date.now()
    session.ancestor = checkpoint.ancestor
    session.generation = checkpoint.generation
    session.history = history ?? []
    session.population = checkpoint.population.map((item) => {
      const individual = createIndividual(item.genome, item.origin)
      individual.result = item.result ?? null
      return individual
    })
    return session
  }

  /** A new experiment founded by a saved champion, with the same settings. */
  branchFrom(record, { name } = {}) {
    return new EvolutionSession({
      name: name ?? `${this.name}, branch at ${record.generation}`,
      ancestor: record.bestGenome,
      config: { ...this.config, seed: hashSeed(this.config.seed, 'branch', record.generation) },
      pool: this.pool,
      evaluator: this.evaluator,
    })
  }
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())
