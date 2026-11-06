// A small feed-forward network: sensors → one tanh hidden layer → one tanh output per
// motor. Weights are genes. Nothing here is a disguised animation: with no connection
// from the clock inputs the output depends entirely on measured body state.
import { MotorDecoder } from './MotorDecoder.js'
import { SensorEncoder, sensorCount } from './SensorEncoder.js'
import { TAU } from '../lib/math.js'

export function neuralWeightCount(genome, hidden) {
  const inputs = sensorCount(genome)
  const outputs = genome.segments.length - 1
  return (inputs + 1) * hidden + (hidden + 1) * outputs
}

function tanh(x) {
  // Rational approximation: Math.tanh is implementation-defined, and this also stays
  // bit-identical across browsers. Clamped so that it saturates at exactly ±1.
  if (x >= 4.97) return 1
  if (x <= -4.97) return -1
  const x2 = x * x
  return (x * (135135 + x2 * (17325 + x2 * (378 + x2)))) / (135135 + x2 * (62370 + x2 * (3150 + x2 * 28)))
}

/** Forward pass. Exposed separately so that tests can exercise it without physics. */
export function forward(weights, hidden, inputs, outputs, activations) {
  const inCount = inputs.length
  const stride = inCount + 1
  for (let h = 0; h < hidden; h++) {
    let sum = weights[h * stride + inCount] // bias
    for (let i = 0; i < inCount; i++) sum += weights[h * stride + i] * inputs[i]
    activations[h] = tanh(sum)
  }
  const base = hidden * stride
  const outStride = hidden + 1
  for (let o = 0; o < outputs.length; o++) {
    let sum = weights[base + o * outStride + hidden] // bias
    for (let h = 0; h < hidden; h++) sum += weights[base + o * outStride + h] * activations[h]
    outputs[o] = tanh(sum)
  }
  return outputs
}

export class NeuralController {
  constructor(genome) {
    const { neural, frequency } = genome.controller
    this.frequency = frequency
    this.hidden = neural.hidden
    this.weights = Float64Array.from(neural.weights)
    this.encoder = new SensorEncoder(genome)
    this.decoder = new MotorDecoder(genome)
    this.inputs = new Float64Array(this.encoder.size)
    this.activations = new Float64Array(this.hidden)
    this.outputs = new Float64Array(genome.segments.length - 1)
  }

  update(t, state, targets) {
    this.encoder.encode(state, TAU * this.frequency * t, this.inputs)
    forward(this.weights, this.hidden, this.inputs, this.outputs, this.activations)
    return this.decoder.decode(this.outputs, targets)
  }
}
