// @vitest-environment node
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { dbClear, dbGet, dbGetAll, dbPut, migrate, openDatabase, StorageUnavailable, resetConnection } from '../../src/storage/Database.js'
import { deleteCreature, listCreatures, makeCreatureRecord, saveCreature } from '../../src/storage/CreatureRepository.js'
import { deleteExperiment, listExperiments, loadExperiment, loadKv, saveCheckpoint, saveGenerationRecord, saveKv, compactRecord } from '../../src/storage/ExperimentRepository.js'
import { createPresets } from '../../src/creatures/CreaturePresets.js'
import { EvolutionSession } from '../../src/evolution/EvolutionSession.js'
import { creatureFile, decodeShareToken, encodeShareToken, replayMetadata } from '../../src/export/GenomeExporter.js'
import { importGenome } from '../../src/creatures/GenomeValidator.js'
import { summarizeForCsv } from '../../src/statistics/StatisticsEngine.js'
import { parseExperimentConfig, statisticsJson } from '../../src/export/StatisticsExporter.js'
import { FLAT, syncEvaluator } from './helpers.js'

beforeEach(async () => {
  await dbClear()
})

describe('database', () => {
  it('stores and reads values', async () => {
    await dbPut('kv', { key: 'a', value: 1 })
    expect((await dbGet('kv', 'a')).value).toBe(1)
    expect((await dbGetAll('kv')).length).toBe(1)
  })

  it('creates every store through migration', async () => {
    const db = await openDatabase()
    expect([...db.objectStoreNames].sort()).toEqual(['creatures', 'experiments', 'generations', 'kv'])
    const created = []
    migrate({ createObjectStore: (name) => created.push(name) }, 0)
    expect(created).toContain('creatures')
    const none = []
    migrate({ createObjectStore: (name) => none.push(name) }, 1)
    expect(none).toEqual([])
  })

  it('reports missing storage clearly', async () => {
    resetConnection()
    await expect(openDatabase(null)).rejects.toBeInstanceOf(StorageUnavailable)
    resetConnection()
    await expect(openDatabase({ open() { throw new Error('denied') } })).rejects.toBeInstanceOf(StorageUnavailable)
    resetConnection()
  })
})

describe('creature repository', () => {
  it('saves, lists and deletes', async () => {
    const [genome] = createPresets()
    const record = makeCreatureRecord(genome, { generation: 4, fitness: 2, distance: 3, envId: 'flat' })
    await saveCreature(record)
    const { creatures, corrupt } = await listCreatures()
    expect(corrupt).toBe(0)
    expect(creatures.length).toBe(1)
    expect(creatures[0].generation).toBe(4)
    expect(creatures[0].genome.segments).toEqual(genome.segments)
    await deleteCreature(record.id)
    expect((await listCreatures()).creatures.length).toBe(0)
  })

  it('skips damaged records rather than losing the rest', async () => {
    const [genome] = createPresets()
    await saveCreature(makeCreatureRecord(genome))
    await dbPut('creatures', { id: 'broken', genome: { segments: 'nope' }, updatedAt: 1 })
    await dbPut('creatures', { id: 'broken2', updatedAt: 1 })
    const { creatures, corrupt } = await listCreatures()
    expect(creatures.length).toBe(1)
    expect(corrupt).toBe(2)
  })
})

describe('experiment repository', () => {
  it('restores an experiment that continues identically', async () => {
    const ancestor = createPresets()[1]
    const config = { seed: 31, populationSize: 6, duration: 1.5, env: FLAT }
    const straight = new EvolutionSession({ ancestor, config, evaluator: syncEvaluator })
    for (let i = 0; i < 4; i++) await straight.stepGeneration()

    const session = new EvolutionSession({ ancestor, config, evaluator: syncEvaluator })
    for (let i = 0; i < 2; i++) {
      const record = await session.stepGeneration()
      await saveGenerationRecord(session.id, record)
    }
    await saveCheckpoint(session.toCheckpoint())

    const listed = await listExperiments()
    expect(listed.map((item) => item.id)).toEqual([session.id])
    const { checkpoint, history } = await loadExperiment(session.id)
    expect(history.length).toBe(2)
    const resumed = EvolutionSession.fromCheckpoint(checkpoint, history, { evaluator: syncEvaluator })
    expect(resumed.generation).toBe(3)
    await resumed.stepGeneration()
    await resumed.stepGeneration()
    expect(resumed.history[3].fitness).toEqual(straight.history[3].fitness)
  })

  it('ignores generations newer than the last checkpoint', async () => {
    const session = new EvolutionSession({ ancestor: createPresets()[1], config: { seed: 1, populationSize: 4, duration: 1, env: FLAT }, evaluator: syncEvaluator })
    await saveGenerationRecord(session.id, compactRecord(session.id, await session.stepGeneration()))
    await saveCheckpoint(session.toCheckpoint())
    await saveGenerationRecord(session.id, await session.stepGeneration())
    const { history } = await loadExperiment(session.id)
    expect(history.length).toBe(1)
  })

  it('deletes an experiment and its history', async () => {
    const session = new EvolutionSession({ ancestor: createPresets()[1], config: { seed: 1, populationSize: 4, duration: 1, env: FLAT }, evaluator: syncEvaluator })
    await saveGenerationRecord(session.id, await session.stepGeneration())
    await saveCheckpoint(session.toCheckpoint())
    await deleteExperiment(session.id)
    expect(await loadExperiment(session.id)).toBeNull()
    expect((await dbGetAll('generations')).length).toBe(0)
  })

  it('stores preferences, with a fallback', async () => {
    await saveKv('theme', 'dark')
    expect(await loadKv('theme')).toBe('dark')
    expect(await loadKv('missing', 7)).toBe(7)
  })
})

describe('export and import', () => {
  it('round-trips creature files', () => {
    const [genome] = createPresets()
    const text = JSON.stringify(creatureFile(genome, { generation: 3 }))
    expect(importGenome(text).segments).toEqual(genome.segments)
  })

  it('round-trips share links, validating what comes back', async () => {
    const [genome] = createPresets()
    const token = await encodeShareToken(genome)
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
    const back = await decodeShareToken(token)
    expect(back.segments.length).toBe(genome.segments.length)
    expect(back.segments[1].w).toBeCloseTo(genome.segments[1].w, 4)
  })

  it('refuses damaged or oversized links', async () => {
    await expect(decodeShareToken('@@@@')).rejects.toThrow(/damaged/)
    await expect(decodeShareToken('')).rejects.toThrow()
    await expect(decodeShareToken('a'.repeat(30000))).rejects.toThrow(/too long/)
  })

  it('describes replays without frames', () => {
    const [genome] = createPresets()
    const meta = replayMetadata(genome, FLAT, 12, { distance: 1, stateHash: 'x' })
    expect(meta.expected.stateHash).toBe('x')
    expect(meta.genome).toBe(genome)
    expect(JSON.stringify(meta)).not.toContain('poses')
  })

  it('imports experiment settings as untrusted input', () => {
    const parsed = parseExperimentConfig(JSON.stringify({
      kind: 'evolve/experiment-config',
      config: { populationSize: 99999, objective: 'efficient', mutation: { rate: -5 }, selection: { method: 'bogus' }, env: { id: 'moon', seed: 3 }, evil: 'field' },
    }))
    expect(parsed.populationSize).toBe(200)
    expect(parsed.objective).toBe('efficient')
    expect(parsed.mutation.rate).toBe(0)
    expect(parsed.selection.method).toBe('tournament')
    expect(parsed.env).toEqual({ id: 'moon', seed: 3 })
    expect(parsed.evil).toBeUndefined()
    expect(() => parseExperimentConfig('nope')).toThrow(/not valid JSON/)
    expect(() => parseExperimentConfig('{"kind":"other"}')).toThrow(/does not contain/)
  })

  it('writes statistics as CSV and JSON', async () => {
    const session = new EvolutionSession({ ancestor: createPresets()[1], config: { seed: 1, populationSize: 4, duration: 1, env: FLAT }, evaluator: syncEvaluator })
    await session.stepGeneration()
    const lines = summarizeForCsv(session.history).split('\n')
    expect(lines[0]).toContain('best_fitness')
    expect(lines.length).toBe(2)
    expect(lines[1].split(',').length).toBe(lines[0].split(',').length)
    const json = statisticsJson(session)
    expect(json.generations.length).toBe(1)
    expect(json.generations[0].bestGenome).toBeUndefined()
  })
})
