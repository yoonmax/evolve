// Physics runs here and nowhere else. A worker is a plain function server: it holds no
// evolutionary state, so killing and replacing one loses nothing but the job in hand.
import { evaluateGenome } from '../evolution/evaluate.js'
import { simulateCreature } from '../physics/SimulationStepper.js'
import { computeFitness } from '../evolution/Fitness.js'
import { MSG, recordingTransferables } from './WorkerProtocol.js'

self.onmessage = ({ data }) => {
  const { jobId, type, payload } = data
  try {
    if (type === MSG.EVALUATE) {
      const results = payload.items.map(({ index, genome }) => ({
        index,
        result: evaluateGenome(genome, payload.env, payload.sim),
      }))
      self.postMessage({ jobId, type: MSG.RESULT, payload: { results } })
    } else if (type === MSG.RECORD) {
      const { metrics, recording } = simulateCreature(payload.genome, payload.env, payload.options)
      const fitness = computeFitness(metrics, payload.sim?.objective, payload.sim?.weights)
      self.postMessage({ jobId, type: MSG.RESULT, payload: { metrics, fitness, recording } }, recordingTransferables(recording))
    } else {
      self.postMessage({ jobId, type: MSG.ERROR, payload: { message: `Unknown job type: ${type}` } })
    }
  } catch (error) {
    self.postMessage({ jobId, type: MSG.ERROR, payload: { message: error?.message ?? 'The simulation failed.' } })
  }
}
