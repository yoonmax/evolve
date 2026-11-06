import { NeuralController } from './NeuralController.js'
import { OscillatorController } from './OscillatorController.js'

export function createController(genome) {
  return genome.controller.type === 'neural' ? new NeuralController(genome) : new OscillatorController(genome)
}
