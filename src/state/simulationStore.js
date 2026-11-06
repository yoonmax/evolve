// The live experiment and what the main arena is showing. Three clocks stay separate:
// evolution runs in workers as fast as they can, playback advances by real time, and
// neither affects the fixed physics timestep inside a run.
import { create } from 'zustand'
import { createPresets, strayCreature } from '../creatures/CreaturePresets.js'
import { generateCreature } from '../creatures/CreatureGenerator.js'
import { EvolutionSession } from '../evolution/EvolutionSession.js'
import { recordRun, makeSimSettings } from '../evolution/EvaluationManager.js'
import { makeConfig } from '../evolution/EvolutionEngine.js'
import { OBJECTIVES } from '../evolution/Fitness.js'
import { ENVIRONMENTS } from '../physics/Environments.js'
import { PlaybackClock } from '../rendering/PlaybackClock.js'
import { makeTrack, trackDuration } from '../rendering/Track.js'
import { Rng, randomSeed } from '../lib/rng.js'
import { getPool } from '../workers/WorkerPool.js'
import { AUTOSAVE_EVERY, listExperiments, loadExperiment, loadKv, saveCheckpoint, saveGenerationRecord, saveKv } from '../storage/ExperimentRepository.js'
import { announce, toast } from './applicationStore.js'
import { CancelledError } from '../workers/WorkerPool.js'

const CAST_DURATION = 9
const GHOST_LIMIT = 12
const CAST_SPACING = 3

const isSmallScreen = () => typeof matchMedia !== 'undefined' && matchMedia('(max-width: 700px)').matches

export const SPEEDS = [0.25, 0.5, 1, 2, 3, 5, 10]

let saveFailureShown = false
let lastChampionSwap = 0
let unsubscribeSession = null

export const useSim = create((set, get) => ({
  cast: createPresets(),
  ancestor: null,
  session: null,
  version: 0, // bumps whenever history changes
  running: false,
  evaluating: null, // {done, total} while a generation is out with the workers
  mode: 'watch', // watch | fast | step
  speed: 1,
  follow: 'champion',
  layout: 'overlay',
  debug: false,
  scene: null,
  clock: new PlaybackClock({ loop: true }),
  viewing: null, // the generation record being replayed, or null for live
  config: makeConfig({ populationSize: isSmallScreen() ? 16 : 30 }),
  limit: null,
  resumable: null,
  error: null,
  initialized: false,

  /** First visit: run the whole cast in the arena without any setup. */
  async init() {
    if (get().initialized) return
    set({ initialized: true, ancestor: get().cast[0] })
    get().findResumable()
    await get().showCast()
  },

  /** A previous visit's experiment, offered back rather than silently lost. */
  async findResumable() {
    try {
      const [last, experiments] = await Promise.all([loadKv('lastExperiment'), listExperiments()])
      const found = experiments.find((item) => item.id === last) ?? experiments[0]
      if (found && !get().session) set({ resumable: { id: found.id, name: found.name, generation: found.generation } })
    } catch {
      /* no storage in this window: nothing to resume */
    }
  },

  async resume() {
    const { resumable } = get()
    if (!resumable) return
    try {
      const loaded = await loadExperiment(resumable.id)
      if (!loaded) throw new Error('That experiment is no longer saved.')
      get().restoreSession(EvolutionSession.fromCheckpoint(loaded.checkpoint, loaded.history, { pool: getPool() }))
      set({ resumable: null })
      toast(`Restored "${resumable.name}" at generation ${loaded.checkpoint.generation}.`)
    } catch (error) {
      set({ resumable: null })
      toast(`Could not restore that experiment: ${error.message}`, { kind: 'error', ms: 7000 })
    }
  },

  setLimit(limit) {
    set({ limit })
  },

  async showCast() {
    const { cast, config, clock } = get()
    const pool = getPool()
    const positions = cast.map((_, i) => (i - (cast.length - 1) / 2) * CAST_SPACING)
    try {
      const runs = await Promise.all(cast.map((genome, i) => recordRun(genome, config.env, pool, { duration: CAST_DURATION, spawnX: positions[i], sim: makeSimSettings(config), group: 'cast' })))
      if (get().session) return
      const tracks = runs.map((run, i) => makeTrack(run, { label: cast[i].name, role: 'cast' }))
      const selected = Math.max(0, cast.indexOf(get().ancestor))
      get().setScene({ tracks, env: config.env, layout: 'overlay', ghostAlpha: 1, ghostShadows: true, nameTags: true, heroIndex: selected, selected, rulerOrigin: 0, intro: true })
      clock.set({ speed: 1, playing: true, loop: true })
      set({ speed: 1, follow: 'fit' })
    } catch (error) {
      if (!(error instanceof CancelledError)) get().fail(error)
    }
  },

  setScene(scene, options = {}) {
    const { clock } = get()
    const duration = scene ? Math.max(...scene.tracks.map(trackDuration)) : 0
    const frameDt = scene?.tracks[0]?.recording.frameDt
    clock.load(duration, { keepTime: options.keepTime, frameDt })
    set({ scene })
  },

  selectAncestor(genome) {
    const { session, scene, cast } = get()
    if (session) return
    set({ ancestor: genome })
    const index = cast.indexOf(genome)
    if (scene?.intro && index >= 0) set({ scene: { ...scene, heroIndex: index, selected: index } })
  },

  /** Begins (or resumes) evolving. */
  async startEvolution() {
    const state = get()
    if (state.running) return
    let session = state.session
    if (!session) {
      session = new EvolutionSession({ ancestor: state.ancestor, config: { ...state.config, seed: state.config.seed === 1 ? randomSeed() % 1000000 : state.config.seed }, pool: getPool() })
      get().attachSession(session)
      set({ speed: 3, follow: 'champion', layout: state.layout })
      get().clock.set({ speed: 3 })
    }
    session.gate = (record) => get().paceGeneration(record)
    set({ running: true, error: null, viewing: null, resumable: null })
    session.run({ limit: state.limit ?? Infinity })
  },

  attachSession(session) {
    unsubscribeSession?.()
    get().session?.dispose()
    unsubscribeSession = session.subscribe((event) => get().handleSessionEvent(event, session))
    set({ session, version: get().version + 1, running: false, viewing: null, evaluating: null, config: session.config, ancestor: session.ancestor })
    saveKv('lastExperiment', session.id).catch(() => {})
  },

  handleSessionEvent(event, session) {
    if (event.type === 'evaluating') {
      set({ evaluating: event.done < event.total ? { done: event.done, total: event.total } : null })
    } else if (event.type === 'generation') {
      const { record } = event
      set((state) => ({ version: state.version + 1, evaluating: null }))
      get().persistGeneration(session, record)
      if (record.failures) toast(`${record.failures} evaluations failed in generation ${record.generation} and were scored as invalid.`, { kind: 'error' })
      const previous = session.history[session.history.length - 2]
      const change = previous ? record.bestDistance - previous.bestDistance : 0
      announce(`Generation ${record.generation} complete. Best distance ${record.bestDistance.toFixed(2)} metres${previous ? `, ${change >= 0 ? 'up' : 'down'} ${Math.abs(change).toFixed(2)}` : ''}.`)
    } else if (event.type === 'status') {
      set({ running: event.running, evaluating: event.running ? get().evaluating : null })
    } else if (event.type === 'error') {
      get().fail(event.error)
    }
  },

  fail(error) {
    console.error(error)
    set({ error: error.message })
    toast(error.message, { kind: 'error', ms: 7000 })
  },

  persistGeneration(session, record) {
    const save = async () => {
      await saveGenerationRecord(session.id, record)
      if (record.generation === 1 || record.generation % AUTOSAVE_EVERY === 0) await saveCheckpoint(session.toCheckpoint())
    }
    save().catch((error) => {
      if (!saveFailureShown) {
        saveFailureShown = true
        toast(`Autosave stopped: ${error.message}`, { kind: 'error', ms: 7000 })
      }
    })
  },

  async saveExperiment() {
    const { session } = get()
    if (!session) {
      toast('Start an experiment first; there is nothing to save yet.')
      return false
    }
    try {
      for (const record of session.history.slice(-AUTOSAVE_EVERY * 2)) await saveGenerationRecord(session.id, record)
      await saveCheckpoint(session.toCheckpoint())
      toast(`Saved "${session.name}" at generation ${session.history.length}.`)
      return true
    } catch (error) {
      toast(error.message, { kind: 'error', ms: 7000 })
      return false
    }
  },

  /**
   * Called between generations. Watch mode waits for this generation to finish playing;
   * fast mode shows a champion only when the arena is ready for a new one.
   */
  async paceGeneration(record) {
    const { mode, viewing, clock, scene } = get()
    if (viewing || mode !== 'watch' || !clock.attached) {
      // Evolving faster than anyone can watch: bring in the newest champion each time the
      // one on screen has finished its run. Only the arena is paced, never evolution.
      const now = performance.now()
      const onScreenFor = (clock.duration / Math.max(clock.speed, 0.01)) * 1000
      const due = !scene || scene.intro || (clock.playing && now - lastChampionSwap >= onScreenFor)
      if (!viewing && clock.attached && due) {
        lastChampionSwap = now
        await get().playGeneration(record, { championOnly: true })
      }
      return
    }
    await get().playGeneration(record)
    await new Promise((resolve) => {
      const session = get().session
      const finish = () => {
        off()
        clearInterval(poll)
        if (session) session.gateRelease = null
        resolve()
      }
      const off = clock.onEnd(finish)
      if (session) session.gateRelease = finish
      // In a hidden tab rAF stops, so the watchdog advances the clock in its place.
      const poll = setInterval(() => {
        if (!get().running || get().mode !== 'watch' || get().viewing || !clock.attached) finish()
        else if (document.hidden && clock.playing) clock.advance(0.25)
      }, 250)
    })
  },

  /** Records a generation's creatures and loads them into the arena. */
  async playGeneration(record, { championOnly = false } = {}) {
    const { session, clock, layout } = get()
    if (!session) return
    const pool = getPool()
    const sim = makeSimSettings(session.config)
    const small = isSmallScreen()
    const limit = championOnly ? 1 : small ? 6 : GHOST_LIMIT
    const members = (record.ranked ?? [{ genome: record.bestGenome, fitness: record.bestFitness, metrics: record.bestMetrics }]).slice(0, limit)
    const env = record.env ?? session.config.env
    try {
      const runs = await Promise.all(members.map((member, i) => recordRun(member.genome, env, pool, { duration: record.duration, detail: i === 0, sim, group: 'playback' })))
      const tracks = runs.map((run, i) => makeTrack(run, { label: i === 0 ? `generation ${record.generation} best` : `rank ${i + 1}`, role: i === 0 ? 'champion' : 'ghost' }))
      const previousBest = session.history.filter((r) => r.generation < record.generation).reduce((best, r) => Math.max(best, r.championDistance), 0)
      get().setScene({
        tracks,
        env,
        layout: tracks.length > 1 ? layout : 'overlay',
        heroIndex: 0,
        selected: 0,
        rulerOrigin: tracks[0].metrics.startX,
        ghostAlpha: 0.22,
        record: previousBest,
        generation: record.generation,
      })
      clock.set({ playing: true, loop: !get().running || get().mode !== 'watch' })
    } catch (error) {
      if (!(error instanceof CancelledError)) get().fail(error)
    }
  },

  /** Plays one generation's champion again, re-simulated from its genome. */
  async viewGeneration(generation) {
    const { session } = get()
    const record = session?.history.find((r) => r.generation === generation)
    if (!record) return
    set({ viewing: record })
    await get().playGeneration(record, { championOnly: !record.ranked || record.ranked.length < 3 })
    get().clock.set({ loop: true, playing: true })
    set({ follow: 'champion' })
    announce(`Showing generation ${generation}: best distance ${record.bestDistance.toFixed(2)} metres.`)
  },

  async backToLive() {
    const { session } = get()
    set({ viewing: null })
    const last = session?.history[session.history.length - 1]
    if (last) await get().playGeneration(last)
    get().clock.set({ loop: !get().running || get().mode !== 'watch', playing: true })
  },

  async nextGeneration() {
    const state = get()
    if (state.running || state.session?.busy) return
    let session = state.session
    if (!session) {
      session = new EvolutionSession({ ancestor: state.ancestor, config: { ...state.config, seed: randomSeed() % 1000000 }, pool: getPool() })
      get().attachSession(session)
      set({ speed: 3, follow: 'champion' })
      get().clock.set({ speed: 3 })
    }
    try {
      const record = await session.stepGeneration()
      set({ viewing: null })
      await get().playGeneration(record)
      get().clock.set({ loop: true, playing: true })
    } catch (error) {
      if (!(error instanceof CancelledError)) get().fail(error)
    }
  },

  stopEvolution() {
    const { session, clock } = get()
    if (!session) return
    session.stop()
    clock.set({ loop: true })
  },

  /** Discards the live experiment. Anything already saved stays in the gallery and history. */
  async resetExperiment() {
    unsubscribeSession?.()
    unsubscribeSession = null
    get().session?.dispose()
    set({ session: null, running: false, evaluating: null, viewing: null, version: get().version + 1, error: null, config: makeConfig({ ...get().config, seed: 1 }) })
    await get().showCast()
  },

  setMode(mode) {
    set({ mode })
    const { running, session } = get()
    if (mode === 'watch' && running && session?.gateRelease) session.gateRelease()
    get().clock.set({ loop: !(running && mode === 'watch') })
  },

  setSpeed(speed) {
    set({ speed })
    get().clock.set({ speed })
  },

  setFollow(follow) {
    set({ follow })
  },

  setLayout(layout) {
    const { scene } = get()
    set({ layout })
    if (scene && scene.tracks.length > 1 && !scene.intro) set({ scene: { ...scene, layout } })
  },

  setDebug(debug) {
    set({ debug })
  },

  updateConfig(partial) {
    const { session, config } = get()
    if (session) {
      session.updateConfig(partial)
      set({ config: session.config, version: get().version + 1 })
    } else {
      set({ config: makeConfig({ ...config, ...partial }) })
    }
  },

  async setEnvironment(id) {
    const { session, config } = get()
    get().updateConfig({ env: { ...config.env, id } })
    if (!session) await get().showCast()
  },

  useAncestor(genome, { start = false } = {}) {
    get().resetExperimentQuietly()
    const cast = get().cast
    set({ ancestor: genome, cast: cast.some((item) => item.name === genome.name) ? cast : [genome, ...cast.slice(0, 5)] })
    const next = get().cast
    set({ ancestor: next.find((item) => item.name === genome.name) ?? genome })
    if (start) get().startEvolution()
    else get().showCast()
  },

  resetExperimentQuietly() {
    unsubscribeSession?.()
    unsubscribeSession = null
    get().session?.dispose()
    set({ session: null, running: false, evaluating: null, viewing: null, version: get().version + 1, config: makeConfig({ ...get().config, seed: 1 }) })
  },

  /** A randomised but valid experiment, started right away. */
  surpriseMe() {
    const seed = randomSeed()
    const rng = new Rng(seed)
    const genome = generateCreature(rng, rng.pick(['simple', 'moderate', 'moderate', 'complex']))
    const env = rng.pick(ENVIRONMENTS.filter((candidate) => candidate.id !== 'heavy'))
    const objective = rng.bool(0.7) ? 'distance' : rng.pick(OBJECTIVES).id
    get().resetExperimentQuietly()
    set({
      config: makeConfig({ seed: seed % 1000000, populationSize: isSmallScreen() ? 16 : 30, env: { id: env.id, seed: rng.int(1000) }, objective }),
      ancestor: genome,
      cast: [genome, ...createPresets().slice(0, 5)],
    })
    toast(`${genome.name}, on ${env.name}, scored by ${OBJECTIVES.find((item) => item.id === objective).name}.`)
    get().startEvolution()
  },

  rerollStray() {
    const stray = strayCreature(randomSeed())
    const cast = get().cast.map((genome) => (genome.name === 'stray' ? stray : genome))
    set({ cast, ancestor: stray })
    if (!get().session) get().showCast()
  },

  restoreSession(session) {
    get().attachSession(session)
    const last = session.history[session.history.length - 1]
    if (last) {
      set({ speed: 3, follow: 'champion' })
      get().clock.set({ speed: 3 })
      get().playGeneration(last, { championOnly: true })
    }
  },
}))
