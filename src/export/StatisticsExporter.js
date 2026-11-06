import { downloadText } from './GenomeExporter.js'
import { summarizeForCsv } from '../statistics/StatisticsEngine.js'
import { makeConfig, POPULATION_LIMITS } from '../evolution/EvolutionEngine.js'
import { OBJECTIVES } from '../evolution/Fitness.js'
import { SELECTION_METHODS } from '../evolution/Selection.js'
import { ENVIRONMENTS } from '../physics/Environments.js'

export function exportStatisticsCsv(session) {
  downloadText(summarizeForCsv(session.history), `evolve-${session.id}-statistics.csv`, 'text/csv')
}

export function statisticsJson(session) {
  return {
    kind: 'evolve/statistics',
    experiment: { id: session.id, name: session.name, config: session.config },
    generations: session.history.map(({ ranked: _ranked, parentGenome: _parentGenome, medianGenome: _medianGenome, bestGenome: _bestGenome, ...record }) => record),
  }
}

export function exportStatisticsJson(session) {
  downloadText(JSON.stringify(statisticsJson(session)), `evolve-${session.id}-statistics.json`)
}

export function exportExperimentConfig(config, name = 'experiment') {
  downloadText(JSON.stringify({ kind: 'evolve/experiment-config', config }, null, 1), `evolve-${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-config.json`)
}

const clampNumber = (value, min, max, fallback) => (typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback)

/** Reads a settings file as untrusted input: known fields only, all values bounded. */
export function parseExperimentConfig(text) {
  let data
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('This file is not valid JSON.')
  }
  const config = data?.config
  if (data?.kind !== 'evolve/experiment-config' || !config || typeof config !== 'object') {
    throw new Error('This file does not contain evolve experiment settings.')
  }
  const base = makeConfig()
  const result = {
    populationSize: Math.round(clampNumber(config.populationSize, POPULATION_LIMITS[0], POPULATION_LIMITS[1], base.populationSize)),
    elites: Math.round(clampNumber(config.elites, 0, 20, base.elites)),
    crossoverRate: clampNumber(config.crossoverRate, 0, 1, base.crossoverRate),
    duration: clampNumber(config.duration, 4, 40, base.duration),
    trials: Math.round(clampNumber(config.trials, 1, 5, base.trials)),
    objective: OBJECTIVES.some((item) => item.id === config.objective) ? config.objective : base.objective,
    mutation: {
      rate: clampNumber(config.mutation?.rate, 0, 1, base.mutation.rate),
      strength: clampNumber(config.mutation?.strength, 0, 1, base.mutation.strength),
      resetRate: clampNumber(config.mutation?.resetRate, 0, 0.5, base.mutation.resetRate),
      bodyRate: clampNumber(config.mutation?.bodyRate, 0, 1, base.mutation.bodyRate),
      structuralRate: clampNumber(config.mutation?.structuralRate, 0, 0.5, base.mutation.structuralRate),
    },
    selection: {
      method: SELECTION_METHODS.some((item) => item.id === config.selection?.method) ? config.selection.method : base.selection.method,
      tournamentSize: Math.round(clampNumber(config.selection?.tournamentSize, 2, 10, base.selection.tournamentSize)),
      rankPressure: clampNumber(config.selection?.rankPressure, 1, 2, base.selection.rankPressure),
    },
    env: {
      id: ENVIRONMENTS.some((item) => item.id === config.env?.id) ? config.env.id : base.env.id,
      seed: Math.round(clampNumber(config.env?.seed, 0, 1e9, base.env.seed)),
    },
  }
  return result
}
