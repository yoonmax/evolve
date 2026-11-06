// A bounded pool of simulation workers with priorities, cancellation, a watchdog and
// crash recovery. There are never more workers than `size`, however many creatures run.
import { MSG } from './WorkerProtocol.js'

const defaultFactory = () => new Worker(new URL('./SimulationWorker.js', import.meta.url), { type: 'module' })

export function suggestedWorkerCount() {
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4
  const memory = typeof navigator !== 'undefined' ? navigator.deviceMemory || 8 : 8
  const budget = memory <= 2 ? 2 : memory <= 4 ? 3 : 8
  return Math.max(1, Math.min(cores - 1, budget))
}

export class WorkerPool {
  constructor({ size = suggestedWorkerCount(), createWorker = defaultFactory, jobTimeoutMs = 30000 } = {}) {
    this.size = size
    this.createWorker = createWorker
    this.jobTimeoutMs = jobTimeoutMs
    this.slots = []
    this.queue = []
    this.nextJobId = 1
    this.crashes = 0
    this.completed = 0
  }

  resize(size) {
    this.size = Math.max(1, size)
    // Idle surplus workers retire immediately; busy ones retire when they finish.
    this.slots = this.slots.filter((slot, index) => {
      if (index >= this.size && !slot.job) {
        slot.worker.terminate()
        return false
      }
      return true
    })
    this.pump()
  }

  /**
   * @param group  jobs sharing a group can be cancelled together
   * @param high   jumps the queue: playback must not wait for a whole generation
   */
  run(type, payload, { group = 'default', high = false, transfer = [] } = {}) {
    return new Promise((resolve, reject) => {
      const job = { id: this.nextJobId++, type, payload, group, resolve, reject, transfer, attempts: 0, cancelled: false }
      if (high) this.queue.unshift(job)
      else this.queue.push(job)
      this.pump()
    })
  }

  cancelGroup(group) {
    this.queue = this.queue.filter((job) => {
      if (job.group !== group) return true
      job.reject(new CancelledError())
      return false
    })
    for (const slot of this.slots) {
      if (slot.job && slot.job.group === group) {
        // Each job is at most a few short simulations; let it end and discard the answer.
        slot.job.cancelled = true
        slot.job.reject(new CancelledError())
      }
    }
  }

  terminate() {
    for (const job of this.queue) job.reject(new CancelledError())
    this.queue = []
    for (const slot of this.slots) {
      clearTimeout(slot.timer)
      if (slot.job && !slot.job.cancelled) slot.job.reject(new CancelledError())
      slot.worker.terminate()
    }
    this.slots = []
  }

  get busy() {
    return this.slots.filter((slot) => slot.job).length
  }

  pump() {
    while (this.queue.length) {
      let slot = this.slots.find((candidate, index) => !candidate.job && index < this.size)
      if (!slot) {
        if (this.slots.length >= this.size) return
        slot = this.spawn()
        if (!slot) return
      }
      this.dispatch(slot, this.queue.shift())
    }
  }

  spawn() {
    let worker
    try {
      worker = this.createWorker()
    } catch (error) {
      for (const job of this.queue) job.reject(new Error(`Could not start a simulation worker: ${error.message}`))
      this.queue = []
      return null
    }
    const slot = { worker, job: null, timer: null }
    worker.onmessage = (event) => this.handleMessage(slot, event.data)
    worker.onerror = (event) => {
      event.preventDefault?.()
      this.handleCrash(slot, event.message ?? 'worker crashed')
    }
    this.slots.push(slot)
    return slot
  }

  dispatch(slot, job) {
    slot.job = job
    job.attempts += 1
    slot.timer = setTimeout(() => this.handleCrash(slot, 'timed out'), this.jobTimeoutMs)
    slot.worker.postMessage({ jobId: job.id, type: job.type, payload: job.payload }, job.transfer)
  }

  handleMessage(slot, message) {
    clearTimeout(slot.timer)
    const job = slot.job
    slot.job = null
    if (job && job.id === message.jobId && !job.cancelled) {
      this.completed += 1
      if (message.type === MSG.ERROR) job.reject(new Error(message.payload.message))
      else job.resolve(message.payload)
    }
    if (this.slots.indexOf(slot) >= this.size) {
      slot.worker.terminate()
      this.slots.splice(this.slots.indexOf(slot), 1)
    }
    this.pump()
  }

  handleCrash(slot, reason) {
    clearTimeout(slot.timer)
    this.crashes += 1
    const job = slot.job
    slot.worker.terminate()
    this.slots.splice(this.slots.indexOf(slot), 1)
    if (job && !job.cancelled) {
      if (job.attempts < 2) this.queue.unshift(job)
      else job.reject(new Error(`A simulation worker failed (${reason}).`))
    }
    this.pump()
  }
}

export class CancelledError extends Error {
  constructor() {
    super('cancelled')
    this.name = 'CancelledError'
  }
}

let sharedPool = null

export function getPool() {
  if (!sharedPool) sharedPool = new WorkerPool()
  return sharedPool
}
