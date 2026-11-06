// Saved organisms. Stored records are re-validated when read, so a damaged entry costs
// that one creature rather than the whole gallery.
import { dbDelete, dbGetAll, dbPut } from './Database.js'
import { importGenome } from '../creatures/GenomeValidator.js'

function newId() {
  return `c-${Date.now().toString(36)}-${Math.floor(Math.random() * 46656).toString(36)}`
}

export function makeCreatureRecord(genome, facts = {}) {
  return {
    id: newId(),
    name: genome.name,
    genome,
    generation: facts.generation ?? null,
    fitness: facts.fitness ?? null,
    distance: facts.distance ?? null,
    envId: facts.envId ?? null,
    objective: facts.objective ?? null,
    controller: genome.controller.type,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

export async function saveCreature(record) {
  await dbPut('creatures', { ...record, updatedAt: Date.now() })
  return record
}

export async function deleteCreature(id) {
  await dbDelete('creatures', id)
}

export async function listCreatures() {
  const rows = await dbGetAll('creatures')
  const creatures = []
  let corrupt = 0
  for (const row of rows) {
    try {
      creatures.push({ ...row, genome: importGenome(row.genome) })
    } catch {
      corrupt++
    }
  }
  creatures.sort((a, b) => b.updatedAt - a.updatedAt)
  return { creatures, corrupt }
}
