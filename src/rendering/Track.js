// A track is one recorded run plus what is needed to draw it. Reading a pose interpolates
// between two recorded solver states; there is no other source of motion anywhere.
import { decodeGenome, shapeArea } from '../creatures/GenomeDecoder.js'
import { anchorPoint } from '../creatures/GenomeDecoder.js'

export function makeTrack(run, extra = {}) {
  const phenotype = decodeGenome(run.genome)
  return {
    genome: run.genome,
    env: run.env,
    recording: run.recording,
    metrics: run.metrics,
    fitness: run.fitness,
    phenotype,
    art: null,
    area: phenotype.parts.map((part) => shapeArea(part.segment)),
    jointLocal: phenotype.parts.map((part, index) => {
      if (index === 0) return null
      const joint = part.segment.joint
      const parent = phenotype.parts[part.segment.parent].segment
      return {
        child: anchorPoint(part.segment, joint.anchorChild),
        parent: anchorPoint(parent, joint.anchorParent),
        parentIndex: part.segment.parent,
      }
    }),
    ...extra,
  }
}

export function trackDuration(track) {
  const r = track.recording
  return Math.max(0, (r.frameCount - 1) * r.frameDt)
}

/** Fractional frame position for a time, clamped to the recording. */
export function frameAt(track, time, out = {}) {
  const r = track.recording
  const f = Math.max(0, Math.min(r.frameCount - 1, time / r.frameDt))
  const a = Math.floor(f)
  out.a = a
  out.b = Math.min(r.frameCount - 1, a + 1)
  out.t = f - a
  return out
}

const scratch = { a: 0, b: 0, t: 0 }

/** Interpolated pose of body `i`. */
export function poseAt(track, i, frame, out) {
  const r = track.recording
  const stride = r.bodyCount * 3
  const pa = frame.a * stride + i * 3
  const pb = frame.b * stride + i * 3
  const t = frame.t
  out.x = r.poses[pa] + (r.poses[pb] - r.poses[pa]) * t
  out.y = r.poses[pa + 1] + (r.poses[pb + 1] - r.poses[pa + 1]) * t
  out.angle = r.poses[pa + 2] + (r.poses[pb + 2] - r.poses[pa + 2]) * t
  return out
}

export function comAt(track, time, out = {}) {
  const frame = frameAt(track, time, scratch)
  const r = track.recording
  out.x = r.com[frame.a * 2] + (r.com[frame.b * 2] - r.com[frame.a * 2]) * frame.t
  out.y = r.com[frame.a * 2 + 1] + (r.com[frame.b * 2 + 1] - r.com[frame.a * 2 + 1]) * frame.t
  return out
}

/** Distance from the start at this moment: the same measurement fitness uses. */
export function distanceAt(track, time) {
  return comAt(track, time).x - track.metrics.startX
}

export function sampleScalars(track, time) {
  const frame = frameAt(track, time, scratch)
  const r = track.recording
  const seconds = frame.a * r.frameDt
  const span = Math.round(0.5 / r.frameDt)
  const back = Math.max(0, frame.a - span)
  const dx = r.com[frame.a * 2] - r.com[back * 2]
  const speed = frame.a > back ? dx / ((frame.a - back) * r.frameDt) : 0
  return {
    time: seconds,
    distance: r.com[frame.a * 2] - track.metrics.startX,
    speed,
    energy: r.energy[frame.a],
    angle: r.poses[frame.a * r.bodyCount * 3 + 2],
    contacts: r.contacts[frame.a],
    frame: frame.a,
  }
}

export function freeTrack(track) {
  track.recording = null
}
