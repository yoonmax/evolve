// Splits a population across the worker pool and collects results in order. Evaluation
// order cannot affect results: each creature gets its own fresh world.
import { MSG } from '../workers/WorkerProtocol.js'
import { CancelledError } from '../workers/WorkerPool.js'

function workerFailure(message) {
  return {
    fitness: -1000,
    metrics: {
      distance: 0, furthest: 0, avgSpeed: 0, bestSpeed: 0, energy: 0, energyNorm: 0, upright: 0, contact: 0, bodyDrag: 0, airTime: 0,
      peakHeight: 0, jointTravel: 0, falls: 0, recoveries: 0, mass: 0, elapsed: 0, steps: 0, startX: 0, finishTime: null,
      peakJointError: 0, invalid: message, invalidAt: 0, stateHash: '', physicsVersion: 0,
    },
  }
}

export function makeSimSettings(config) {
  return { duration: config.duration, trials: config.trials, objective: config.objective, weights: config.weights }
}

/** Evaluates every individual without a result. Rejects with CancelledError when cancelled. */
export async function evaluatePopulation(population, config, pool, { group = 'evolution', onProgress } = {}) {
  const pending = population.map((individual, index) => ({ individual, index })).filter(({ individual }) => !individual.result)
  const total = pending.length
  if (!total) return { failures: 0 }
  const chunkSize = Math.max(1, Math.min(8, Math.ceil(total / (pool.size * 3))))
  const sim = makeSimSettings(config)
  let done = 0
  let failures = 0
  const jobs = []
  for (let i = 0; i < total; i += chunkSize) {
    const chunk = pending.slice(i, i + chunkSize)
    const items = chunk.map(({ individual, index }) => ({ index, genome: individual.genome }))
    jobs.push(
      pool
        .run(MSG.EVALUATE, { items, env: config.env, sim }, { group })
        .then(({ results }) => {
          for (const { index, result } of results) population[index].result = result
        })
        .catch((error) => {
          if (error instanceof CancelledError) throw error
          // A crashed job penalises its individuals rather than ending the experiment.
          failures += chunk.length
          for (const { individual } of chunk) individual.result = workerFailure(error.message)
        })
        .finally(() => {
          done += chunk.length
          onProgress?.(done, total)
        }),
    )
  }
  await Promise.all(jobs)
  return { failures }
}

export const RECORD_EVERY = 2 // 60 Hz keyframes: every state drawn is a real solver state

/** Re-simulates one genome with recording on. Used by every replay in the app. */
export async function recordRun(genome, env, pool, { duration = 12, spawnX = 0, detail = false, every = RECORD_EVERY, sim, finishLine = null, group = 'playback', high = true } = {}) {
  const result = await pool.run(
    MSG.RECORD,
    { genome, env, options: { duration, spawnX, finishLine, record: { every, detail } }, sim },
    { group, high },
  )
  return { genome, env, ...result }
}
