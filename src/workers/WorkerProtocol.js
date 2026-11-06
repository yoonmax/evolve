// Messages between the UI thread and simulation workers. Plain data only.
export const MSG = {
  EVALUATE: 'evaluate', // {items: [{index, genome}], env, sim} → {results: [{index, result}]}
  RECORD: 'record', // {genome, env, options, sim} → {metrics, fitness, recording}
  RESULT: 'result',
  ERROR: 'error',
}

/** Typed arrays in a recording can move across threads instead of being copied. */
export function recordingTransferables(recording) {
  if (!recording) return []
  const buffers = [recording.poses.buffer, recording.com.buffer, recording.energy.buffer, recording.contacts.buffer]
  if (recording.detail) buffers.push(recording.angles.buffer, recording.targets.buffer, recording.torques.buffer, recording.points.buffer)
  return buffers
}
