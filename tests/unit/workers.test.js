import { describe, expect, it, vi } from 'vitest'
import { CancelledError, WorkerPool } from '../../src/workers/WorkerPool.js'
import { evaluatePopulation } from '../../src/evolution/EvaluationManager.js'
import { createIndividual } from '../../src/evolution/Population.js'
import { createPresets } from '../../src/creatures/CreaturePresets.js'
import { makeConfig } from '../../src/evolution/EvolutionEngine.js'
import { MSG } from '../../src/workers/WorkerProtocol.js'

/** Stands in for a Worker. The test decides when and how it answers. */
class FakeWorker {
  static instances = []
  constructor() {
    this.messages = []
    this.terminated = false
    FakeWorker.instances.push(this)
  }
  postMessage(message) {
    this.messages.push(message)
    this.onPost?.(message, this)
  }
  respond(payload, jobId = this.messages[this.messages.length - 1].jobId) {
    this.onmessage({ data: { jobId, type: MSG.RESULT, payload } })
  }
  terminate() {
    this.terminated = true
  }
}

function pool(size, options = {}) {
  FakeWorker.instances = []
  return new WorkerPool({ size, createWorker: () => new FakeWorker(), ...options })
}

describe('worker pool', () => {
  it('never starts more workers than its limit, whatever the queue', async () => {
    const p = pool(2)
    for (let i = 0; i < 10; i++) p.run('x', {}).catch(() => {})
    expect(FakeWorker.instances.length).toBe(2)
    expect(p.queue.length).toBe(8)
    p.terminate()
  })

  it('hands queued jobs out as workers free up', async () => {
    const p = pool(1)
    const first = p.run('x', { n: 1 })
    const second = p.run('x', { n: 2 })
    const worker = FakeWorker.instances[0]
    worker.respond({ answer: 1 })
    await expect(first).resolves.toEqual({ answer: 1 })
    expect(worker.messages[1].payload.n).toBe(2)
    worker.respond({ answer: 2 })
    await expect(second).resolves.toEqual({ answer: 2 })
  })

  it('lets high-priority jobs jump the queue', () => {
    const p = pool(1)
    p.run('x', { n: 1 }).catch(() => {})
    p.run('x', { n: 2 }).catch(() => {})
    p.run('x', { n: 3 }, { high: true }).catch(() => {})
    expect(p.queue[0].payload.n).toBe(3)
    p.terminate()
  })

  it('cancels a group, both queued and in flight', async () => {
    const p = pool(1)
    const running = p.run('x', {}, { group: 'g' })
    const queued = p.run('x', {}, { group: 'g' })
    const other = p.run('x', { keep: true }, { group: 'h' })
    p.cancelGroup('g')
    await expect(running).rejects.toBeInstanceOf(CancelledError)
    await expect(queued).rejects.toBeInstanceOf(CancelledError)
    // the discarded answer arrives; the slot is freed and the other job proceeds
    FakeWorker.instances[0].respond({ late: true })
    FakeWorker.instances[0].respond({ ok: true })
    await expect(other).resolves.toEqual({ ok: true })
  })

  it('replaces a crashed worker and retries the job once', async () => {
    const p = pool(1)
    const job = p.run('x', {})
    const first = FakeWorker.instances[0]
    first.onerror({ message: 'boom', preventDefault() {} })
    expect(first.terminated).toBe(true)
    expect(FakeWorker.instances.length).toBe(2)
    FakeWorker.instances[1].respond({ ok: 1 })
    await expect(job).resolves.toEqual({ ok: 1 })
    expect(p.crashes).toBe(1)
  })

  it('gives up after a second crash with a clear error', async () => {
    const p = pool(1)
    const job = p.run('x', {})
    FakeWorker.instances[0].onerror({ message: 'boom' })
    FakeWorker.instances[1].onerror({ message: 'boom' })
    await expect(job).rejects.toThrow(/worker failed/)
  })

  it('times out stuck workers', async () => {
    vi.useFakeTimers()
    const p = pool(1, { jobTimeoutMs: 1000 })
    const job = p.run('x', {})
    job.catch(() => {})
    vi.advanceTimersByTime(1001)
    expect(FakeWorker.instances[0].terminated).toBe(true)
    vi.advanceTimersByTime(1001)
    vi.useRealTimers()
    await expect(job).rejects.toThrow(/timed out/)
  })

  it('reports worker errors for a job', async () => {
    const p = pool(1)
    const job = p.run('x', {})
    const worker = FakeWorker.instances[0]
    worker.onmessage({ data: { jobId: worker.messages[0].jobId, type: MSG.ERROR, payload: { message: 'bad genome' } } })
    await expect(job).rejects.toThrow('bad genome')
  })

  it('shrinks when resized, without killing busy workers', async () => {
    const p = pool(3)
    const jobs = [p.run('x', {}), p.run('x', {}), p.run('x', {})]
    jobs.forEach((job) => job.catch(() => {}))
    p.resize(1)
    expect(p.slots.length).toBe(3)
    FakeWorker.instances[2].respond({})
    await jobs[2]
    expect(p.slots.length).toBe(2)
    expect(FakeWorker.instances[2].terminated).toBe(true)
    p.terminate()
  })
})

describe('evaluation manager', () => {
  const genome = createPresets()[0]
  const config = makeConfig({ populationSize: 10, duration: 1 })
  const population = () => Array.from({ length: 10 }, () => createIndividual(genome, 'founder'))
  const answer = (message, worker) => {
    const results = message.payload.items.map(({ index }) => ({ index, result: { fitness: index, metrics: { invalid: null } } }))
    queueMicrotask(() => worker.respond({ results }, message.jobId))
  }

  it('evaluates everyone exactly once, returning scores to the right individuals', async () => {
    const p = new WorkerPool({ size: 3, createWorker: () => { const w = new FakeWorker(); w.onPost = answer; return w } })
    const pop = population()
    const progress = []
    await evaluatePopulation(pop, config, p, { onProgress: (done) => progress.push(done) })
    pop.forEach((individual, index) => expect(individual.result.fitness).toBe(index))
    expect(progress[progress.length - 1]).toBe(10)
    p.terminate()
  })

  it('skips individuals that already have a result', async () => {
    let sent = 0
    const p = new WorkerPool({ size: 1, createWorker: () => {
      const w = new FakeWorker()
      w.onPost = (message, worker) => {
        sent += message.payload.items.length
        answer(message, worker)
      }
      return w
    } })
    const pop = population()
    pop[0].result = { fitness: 99, metrics: {} }
    pop[1].result = { fitness: 98, metrics: {} }
    await evaluatePopulation(pop, config, p)
    expect(sent).toBe(8)
    expect(pop[0].result.fitness).toBe(99)
    p.terminate()
  })

  it('scores crashed jobs as invalid rather than failing the generation', async () => {
    const p = new WorkerPool({ size: 1, createWorker: () => {
      const w = new FakeWorker()
      w.onPost = (message, worker) => queueMicrotask(() => worker.onmessage({ data: { jobId: message.jobId, type: MSG.ERROR, payload: { message: 'broken' } } }))
      return w
    } })
    const pop = population()
    const { failures } = await evaluatePopulation(pop, config, p)
    expect(failures).toBe(10)
    expect(pop[0].result.metrics.invalid).toBe('broken')
    expect(pop[0].result.fitness).toBeLessThan(0)
    p.terminate()
  })
})
