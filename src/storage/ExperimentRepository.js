// Experiments persist as a checkpoint (enough to continue) plus one row per generation.
// Physics frames are never stored: replays re-simulate from the genome.
import { dbDelete, dbGet, dbGetAll, dbPut, openDatabase } from './Database.js'

export const AUTOSAVE_EVERY = 5

export function compactRecord(experimentId, record) {
  const { ranked: _ranked, parentGenome: _parentGenome, medianGenome: _medianGenome, ...rest } = record
  return { ...rest, experimentId }
}

export async function saveGenerationRecord(experimentId, record) {
  await dbPut('generations', compactRecord(experimentId, record))
}

export async function saveCheckpoint(checkpoint) {
  await dbPut('experiments', checkpoint)
}

export async function listExperiments() {
  const rows = await dbGetAll('experiments')
  return rows.filter((row) => row && row.id && Array.isArray(row.population)).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
}

export async function loadExperiment(id) {
  const checkpoint = await dbGet('experiments', id)
  if (!checkpoint) return null
  const range = IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER])
  const history = await dbGetAll('generations', range)
  history.sort((a, b) => a.generation - b.generation)
  // Generations saved after the last checkpoint are ignored: they would refer to a
  // population that no longer exists, and breaking the record's continuity is worse.
  return { checkpoint, history: history.filter((record) => record.generation < checkpoint.generation) }
}

export async function deleteExperiment(id) {
  await dbDelete('experiments', id)
  const db = await openDatabase()
  const tx = db.transaction('generations', 'readwrite')
  tx.objectStore('generations').delete(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]))
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function saveKv(key, value) {
  await dbPut('kv', { key, value })
}

export async function loadKv(key, fallback = null) {
  try {
    const row = await dbGet('kv', key)
    return row ? row.value : fallback
  } catch {
    return fallback
  }
}
