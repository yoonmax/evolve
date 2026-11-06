import { useEffect, useMemo, useRef, useState } from 'react'
import gsap from 'gsap'
import Arena from '../components/Arena.jsx'
import LineageChart from '../components/LineageChart.jsx'
import Thumb from '../components/Thumb.jsx'
import { IconButton, Readout, Segmented, Select, Toggle, fmt } from '../components/ui.jsx'
import { SPEEDS, useSim } from '../state/simulationStore.js'
import { useApp, toast } from '../state/applicationStore.js'
import { ENVIRONMENTS, getEnvironment } from '../physics/Environments.js'
import { makeCreatureRecord, saveCreature } from '../storage/CreatureRepository.js'
import { sampleScalars } from '../rendering/Track.js'
import { exportCreature } from '../export/GenomeExporter.js'
import { exportArenaScreenshot } from '../export/ScreenshotExporter.js'

const DEBUG_OPTIONS = { shapes: true, joints: true, motors: true, contacts: true, forces: true, com: true }
const POPULATIONS = [8, 16, 30, 60, 100, 200]

export default function SimulatePage() {
  const sim = useSim()
  const { scene, clock, session, version, running, evaluating, mode, speed, follow, debug, viewing, config, cast, ancestor, layout, error } = sim
  const prefs = useApp((state) => state.prefs)
  const advanced = useApp((state) => state.advanced)
  const [statsOpen, setStatsOpen] = useState(() => !matchMedia('(max-width: 700px)').matches)
  const [moreOpen, setMoreOpen] = useState(false)
  const [explainOpen, setExplainOpen] = useState(false)
  const generationRef = useRef(null)
  const distanceRef = useRef(null)
  const lastGeneration = useRef(null)

  const history = useMemo(() => session?.history ?? [], [session])
  const latest = history[history.length - 1] ?? null
  const shownGeneration = viewing?.generation ?? scene?.generation ?? null
  const intro = !session

  useEffect(() => {
    sim.init()
    // init is idempotent and only needs to run on arrival
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The generation number turning over is the moment worth animating.
  useEffect(() => {
    if (shownGeneration === null || lastGeneration.current === shownGeneration) return
    lastGeneration.current = shownGeneration
    const node = generationRef.current
    if (node && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      gsap.fromTo(node, { y: 14, opacity: 0.2 }, { y: 0, opacity: 1, duration: 0.32, ease: 'power3.out', overwrite: true })
    }
  }, [shownGeneration])

  const onFrame = (time) => {
    if (!scene || scene.intro) return
    const hero = scene.tracks[scene.heroIndex ?? 0]
    if (!hero) return
    const scalars = sampleScalars(hero, time)
    if (distanceRef.current) distanceRef.current.textContent = scalars.distance.toFixed(2)
  }

  const onPick = (index) => {
    if (scene?.intro) sim.selectAncestor(cast[index])
    else if (scene) useSim.setState({ scene: { ...scene, heroIndex: index, selected: index } })
  }

  const saveBest = async () => {
    const record = viewing ?? latest
    if (!record) return
    const genome = { ...record.bestGenome, name: `${session.ancestor.name} g${record.generation}` }
    try {
      await saveCreature(makeCreatureRecord(genome, { generation: record.generation, fitness: record.bestFitness, distance: record.bestMetrics.distance, envId: record.envId, objective: record.objective }))
      toast(`Saved ${genome.name} to the gallery.`)
    } catch (err) {
      toast(err.message, { kind: 'error' })
    }
  }

  const improvement = latest && history.length > 1 ? latest.bestDistance - history[0].bestDistance : null
  const statusText = (() => {
    if (error) return error
    if (evaluating) return `Testing generation ${session.generation}: ${evaluating.done} of ${evaluating.total}`
    if (viewing) return `Replaying the best of generation ${viewing.generation}`
    if (running) return mode === 'fast' ? 'Evolving at full speed; showing the latest best' : `Showing generation ${scene?.generation ?? 1}`
    if (session) return history.length ? `Stopped after generation ${history.length}` : 'Ready to evolve'
    return `${getEnvironment(config.env.id).note} Each creature is simulated alone, so they pass through each other.`
  })()

  return (
    <>
      <Arena
        scene={scene}
        clock={clock}
        follow={follow}
        debug={debug ? DEBUG_OPTIONS : null}
        trails={prefs.trails && !intro}
        onPick={onPick}
        onFrame={onFrame}
        primary
        onUserCamera={(next) => sim.setFollow(next)}
        label={intro ? 'Six starter creatures trying to move across flat ground.' : `Generation ${shownGeneration ?? 1}. Best creature with its population.`}
      >
        {intro ? (
          <div className="intro">
            <h1>None of these can walk yet.</h1>
            <p>The ones that get furthest reproduce, with small mutations. Pick a creature and see what selection makes of it.</p>
            <div className="cast" role="group" aria-label="Choose a starting creature">
              {cast.map((genome) => (
                <button key={genome.name} type="button" className="cast-item" aria-pressed={ancestor === genome} title={genome.tagline} onClick={() => sim.selectAncestor(genome)}>
                  <Thumb genome={genome} />
                  {genome.name}
                </button>
              ))}
            </div>
            <div className="intro-actions">
              <button type="button" className="btn btn-primary btn-large" data-testid="start-evolution" onClick={() => sim.startEvolution()}>
                Start evolution
              </button>
              <button type="button" className="btn btn-large" data-testid="surprise" onClick={() => sim.surpriseMe()}>Surprise me</button>
            </div>
            {sim.resumable ? (
              <button type="button" className="btn" style={{ alignSelf: 'flex-start' }} data-testid="resume" onClick={() => sim.resume()}>
                Continue {sim.resumable.name}, generation {sim.resumable.generation}
              </button>
            ) : null}
            <button type="button" className="link-button" aria-expanded={explainOpen} onClick={() => setExplainOpen(!explainOpen)}>How does this work?</button>
            {explainOpen ? (
              <div className="explain" data-testid="explain">
                <p>Nothing here is animated by hand. Every movement comes from motors pushing simulated bodies.</p>
                <ol>
                  <li>A population of slightly different creatures each gets 12 seconds to move right.</li>
                  <li>The furthest travellers are chosen as parents; their genes are mixed and mutated.</li>
                  <li>Repeat. You watch the best of each generation, and the lineage below keeps score.</li>
                </ol>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="arena-hud">
            <Readout className="hud-major" value={shownGeneration ?? '…'} label={viewing ? 'replaying generation' : 'generation'} valueRef={generationRef} />
            <Readout value="0.00" unit="m" label="distance" valueRef={distanceRef} />
          </div>
        )}
        {session && latest ? (
          <aside className="side-sheet" aria-label="Evolution statistics">
            <div className="sheet-head">
              <h2>{latest.populationSize} creatures</h2>
              <button type="button" className="btn btn-quiet" aria-expanded={statsOpen} onClick={() => setStatsOpen(!statsOpen)}>{statsOpen ? 'Hide' : 'Show'}</button>
            </div>
            {statsOpen ? (
              <>
                <div className="stat-grid" data-testid="stats">
                  <Readout value={fmt.m(latest.bestFitness)} label="best fitness" />
                  <Readout value={fmt.m(latest.meanFitness)} label="mean fitness" />
                  <Readout value={fmt.m(latest.bestDistance)} unit="m" label="best distance" />
                  <Readout value={improvement === null ? '–' : `${improvement >= 0 ? '+' : ''}${improvement.toFixed(2)}`} unit={improvement === null ? '' : 'm'} label="since generation 1" />
                </div>
                <p className="tag" style={{ marginTop: 10 }}>Elites keep the best score safe. Everything else can get worse before it gets better.</p>
                <div className="sheet-actions">
                  <button type="button" className="btn btn-quiet" data-testid="details" onClick={() => useApp.getState().navigate('evolve')}>Charts</button>
                  <button type="button" className="btn btn-quiet" data-testid="export-best" onClick={() => exportCreature((viewing ?? latest).bestGenome, { generation: (viewing ?? latest).generation, fitness: (viewing ?? latest).bestFitness })}>Export best</button>
                  <button type="button" className="btn btn-quiet" data-testid="screenshot" onClick={() => exportArenaScreenshot()}>Screenshot</button>
                </div>
              </>
            ) : null}
          </aside>
        ) : null}
        <div className="arena-note status-line" data-testid="status">
          <span className={`status-dot ${running ? 'live' : ''}`} />
          <span>{statusText}</span>
          {viewing ? <button type="button" className="btn btn-quiet" style={{ pointerEvents: 'auto', minHeight: 24 }} onClick={() => sim.backToLive()}>Back to latest</button> : null}
        </div>
      </Arena>

      {intro ? <div className="hide-small"><LineageChart history={history} version={version} selected={null} onSelect={() => {}} /></div> : <LineageChart history={history} version={version} selected={viewing?.generation ?? null} onSelect={(generation) => sim.viewGeneration(generation)} />}

      <div className={`control-bar ${intro ? 'hide-small' : ''}`} role="toolbar" aria-label="Simulation controls">
        <div className="control-group">
          <IconButton icon={clock.playing ? 'pause' : 'play'} label={clock.playing ? 'Pause playback' : 'Play'} data-testid="play-pause" onClick={() => { clock.set({ playing: !clock.playing }); useSim.setState({ version: version + 1 }) }} />
          <IconButton icon="reset" label="Reset experiment" data-testid="reset" onClick={() => sim.resetExperiment()} />
        </div>
        <div className="control-group">
          {running ? (
            <button type="button" className="btn btn-primary" data-testid="stop" onClick={() => sim.stopEvolution()}>Stop evolving</button>
          ) : (
            <button type="button" className="btn btn-primary" data-testid="evolve" onClick={() => sim.startEvolution()}>{session ? 'Keep evolving' : 'Start evolving'}</button>
          )}
          <button type="button" className="btn" data-testid="next-generation" disabled={running || Boolean(evaluating)} onClick={() => sim.nextGeneration()}>Next generation</button>
        </div>
        <button type="button" className="btn btn-quiet show-small" aria-expanded={moreOpen} data-testid="more-controls" onClick={() => setMoreOpen(!moreOpen)}>{moreOpen ? 'Less' : 'More'}</button>
        <div className={`control-more ${moreOpen ? 'is-open' : ''}`}>
        <Segmented
          label="Evolution pace"
          value={mode}
          onChange={(value) => sim.setMode(value)}
          options={[
            { value: 'watch', label: 'Watch', title: 'Play each generation in the arena before the next' },
            { value: 'fast', label: 'Fast', title: 'Evolve as fast as possible; the arena shows the latest best' },
          ]}
        />
        <span className="control-sep" />
        <div className="control-group">
          <Select hideLabel label="Playback speed" value={String(speed)} onChange={(value) => sim.setSpeed(Number(value))} options={SPEEDS.map((value) => ({ value: String(value), label: `${value}×` }))} testId="speed" />
          <Select label="Population" value={String(config.populationSize)} onChange={(value) => sim.updateConfig({ populationSize: Number(value) })} options={(POPULATIONS.includes(config.populationSize) ? POPULATIONS : [...POPULATIONS, config.populationSize].sort((a, b) => a - b)).map((value) => ({ value: String(value), label: String(value) }))} testId="population" hideLabel />
          <Select hideLabel label="Environment" value={config.env.id} onChange={(value) => sim.setEnvironment(value)} options={ENVIRONMENTS.map((env) => ({ value: env.id, label: env.name }))} testId="environment" />
        </div>
        </div>
        <div className="bar-spacer" />
        <div className={`control-group ${moreOpen ? '' : 'hide-small'}`}>
          <Select hideLabel label="Camera" value={follow} onChange={(value) => sim.setFollow(value)} options={[
            { value: 'champion', label: 'Follow best' },
            { value: 'leader', label: 'Follow leader' },
            { value: 'fit', label: 'Fit all' },
            { value: 'free', label: 'Free camera' },
            { value: 'locked', label: 'Lock camera' },
          ]} testId="camera" />
          {advanced || session ? (
            <Select hideLabel label="View" value={layout} onChange={(value) => sim.setLayout(value)} options={[{ value: 'overlay', label: 'One arena' }, { value: 'grid', label: 'Tiled arenas' }]} testId="layout" />
          ) : null}
          <Toggle label="Physics" checked={debug} onChange={(value) => sim.setDebug(value)} />
          {latest ? <button type="button" className="btn" data-testid="save-best" onClick={saveBest}>Save best</button> : null}
        </div>
      </div>
    </>
  )
}
