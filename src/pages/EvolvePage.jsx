// The experiment in detail: settings, charts, history, replay, comparison.
import { useEffect, useMemo, useState } from 'react'
import Arena from '../components/Arena.jsx'
import { Readout, Select, Slider, Toggle, fmt } from '../components/ui.jsx'
import { Histogram, LineChart, Scatter } from '../statistics/EvolutionCharts.jsx'
import ReplayControls, { useClockLoop } from '../replay/ReplayControls.jsx'
import { useRecordedScene } from '../replay/useRecordedScene.js'
import { PlaybackClock } from '../rendering/PlaybackClock.js'
import { useSim } from '../state/simulationStore.js'
import { toast, useApp } from '../state/applicationStore.js'
import { OBJECTIVES, getObjective } from '../evolution/Fitness.js'
import { SELECTION_METHODS } from '../evolution/Selection.js'
import { listGenes } from '../creatures/Genome.js'
import { deleteExperiment, listExperiments, loadExperiment } from '../storage/ExperimentRepository.js'
import { makeCreatureRecord, saveCreature } from '../storage/CreatureRepository.js'
import { EvolutionSession } from '../evolution/EvolutionSession.js'
import { getPool } from '../workers/WorkerPool.js'
import { exportCreature, exportReplayMetadata } from '../export/GenomeExporter.js'
import { exportExperimentConfig, exportStatisticsCsv, exportStatisticsJson, parseExperimentConfig } from '../export/StatisticsExporter.js'
import { exportArenaScreenshot } from '../export/ScreenshotExporter.js'
import { listCreatures } from '../storage/CreatureRepository.js'
import { createPresets } from '../creatures/CreaturePresets.js'
import { makeSimSettings } from '../evolution/EvaluationManager.js'

export default function EvolvePage() {
  const session = useSim((state) => state.session)
  const version = useSim((state) => state.version)
  const running = useSim((state) => state.running)
  const config = useSim((state) => state.config)
  const history = useMemo(() => session?.history ?? [], [session])
  const [selectedGeneration, setSelectedGeneration] = useState(null)
  const latest = history[history.length - 1]
  const selected = history.find((record) => record.generation === selectedGeneration) ?? latest ?? null

  return (
    <div className="page" data-testid="evolve-page" data-version={version}>
      <div className="page-head">
        <div>
          <h1 className="page-title">{session ? session.name : 'No experiment running'}</h1>
          <p className="page-lede">
            {session
              ? `${history.length} generations so far${running ? ', still evolving' : ''}. All numbers are measured from simulated runs.`
              : 'Set up evolution here, then start it from the simulate tab. Results and history will appear on this page.'}
          </p>
        </div>
        <div className="row">
          {session ? (
            <>
              {running
                ? <button type="button" className="btn" onClick={() => useSim.getState().stopEvolution()}>Stop evolving</button>
                : <button type="button" className="btn btn-primary" onClick={() => useSim.getState().startEvolution()}>Keep evolving</button>}
              <button type="button" className="btn" data-testid="export-csv" disabled={!history.length} onClick={() => exportStatisticsCsv(session)}>Export CSV</button>
              <button type="button" className="btn" disabled={!history.length} onClick={() => exportStatisticsJson(session)}>Export JSON</button>
              <button type="button" className="btn btn-quiet" onClick={() => exportExperimentConfig(session.config, session.name)}>Export settings</button>
            </>
          ) : <a className="btn btn-primary" href="#/simulate">Go to simulate</a>}
          <input type="file" accept="application/json,.json" hidden data-testid="import-settings" onChange={async (event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (!file) return
            try {
              useSim.getState().updateConfig(parseExperimentConfig(await file.text()))
              toast('Settings imported. They apply from the next generation.')
            } catch (error) {
              toast(error.message, { kind: 'error', ms: 7000 })
            }
          }} />
          <button type="button" className="btn btn-quiet" onClick={(event) => event.currentTarget.previousSibling.click()}>Import settings</button>
        </div>
      </div>

      <SettingsSection config={config} />

      {history.length ? (
        <>
          <ChartsSection history={history} selected={selected} onSelect={setSelectedGeneration} session={session} version={version} />
          <HistorySection history={history} selected={selected} onSelect={setSelectedGeneration} session={session} />
          <CompareSection session={session} history={history} />
        </>
      ) : null}
      <SavedExperiments />
      <HonestySection />
    </div>
  )
}

function SettingsSection({ config }) {
  const advanced = useApp((state) => state.advanced)
  const update = (partial) => useSim.getState().updateConfig(partial)
  const session = useSim((state) => state.session)
  const limit = useSim((state) => state.limit)
  const objective = getObjective(config.objective)
  const setMutation = (key) => (value) => update({ mutation: { ...config.mutation, [key]: value } })
  const setSelection = (key) => (value) => update({ selection: { ...config.selection, [key]: value } })
  return (
    <section className="section" aria-labelledby="settings-title">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 className="section-title" id="settings-title">How evolution runs</h2>
        <Toggle label="Show all settings" checked={advanced} onChange={(value) => useApp.getState().setAdvanced(value)} />
      </div>
      <p className="section-note">Changes apply from the next generation. {objective.note}</p>
      <div className="form-grid">
        <Select label="What counts as success" value={config.objective} onChange={(value) => update({ objective: value })} options={OBJECTIVES.map((item) => ({ value: item.id, label: item.name }))} testId="objective" />
        <Select label="Controller" value={config.controller} disabled={Boolean(session)} onChange={(value) => update({ controller: value })} options={[{ value: 'oscillator', label: 'oscillators' }, { value: 'neural', label: 'neural network' }]} testId="controller" />
        <Slider label="Mutation rate" value={config.mutation.rate} min={0.01} max={0.8} onChange={setMutation('rate')} format={(value) => `${Math.round(value * 100)}% of genes`} />
        <Slider label="Population" value={config.populationSize} min={4} max={200} step={2} onChange={(value) => update({ populationSize: value })} format={(value) => `${value} creatures`} />
        {advanced ? (
          <>
            <Select label="Stop automatically" value={String(limit ?? 'none')} onChange={(value) => useSim.getState().setLimit(value === 'none' ? null : Number(value))} options={[{ value: 'none', label: 'never' }, ...[25, 50, 100, 250, 500, 1000].map((value) => ({ value: String(value), label: `after generation ${value}` }))]} testId="generation-limit" />
            <Slider label="Mutation size" value={config.mutation.strength} min={0.01} max={0.4} onChange={setMutation('strength')} format={(value) => `${Math.round(value * 100)}% of range`} />
            <Slider label="Random gene reset" value={config.mutation.resetRate} min={0} max={0.1} step={0.005} onChange={setMutation('resetRate')} format={(value) => `${(value * 100).toFixed(1)}%`} />
            <Slider label="Body and motor mutation" value={config.mutation.bodyRate} min={0} max={1} onChange={setMutation('bodyRate')} format={(value) => (value === 0 ? 'body frozen' : `${Math.round(value * 100)}% of base rate`)} />
            <Slider label="Limb gain or loss" value={config.mutation.structuralRate} min={0} max={0.2} step={0.005} onChange={setMutation('structuralRate')} format={(value) => (value === 0 ? 'off' : `${(value * 100).toFixed(1)}% of offspring`)} />
            <Select label="Selection method" value={config.selection.method} onChange={setSelection('method')} options={SELECTION_METHODS.map((item) => ({ value: item.id, label: item.name }))} testId="selection-method" />
            {config.selection.method === 'tournament' ? <Slider label="Tournament size" value={config.selection.tournamentSize} min={2} max={10} step={1} onChange={setSelection('tournamentSize')} format={(value) => `${value} entrants`} /> : null}
            {config.selection.method === 'rank' ? <Slider label="Selection pressure" value={config.selection.rankPressure} min={1} max={2} onChange={setSelection('rankPressure')} format={(value) => value.toFixed(2)} /> : null}
            <Slider label="Elites kept unchanged" value={config.elites} min={0} max={Math.min(20, config.populationSize - 1)} step={1} onChange={(value) => update({ elites: value })} format={(value) => String(value)} />
            <Slider label="Crossover" value={config.crossoverRate} min={0} max={1} onChange={(value) => update({ crossoverRate: value })} format={(value) => `${Math.round(value * 100)}% of offspring`} />
            <Slider label="Test length" value={config.duration} min={4} max={40} step={1} onChange={(value) => update({ duration: value })} format={(value) => `${value} s`} />
            <Slider label="Terrain samples" value={config.trials} min={1} max={5} step={1} onChange={(value) => update({ trials: value })} format={(value) => `${value} per creature`} />
            <Slider label="Energy cost" value={config.weights.energy} min={0} max={0.1} step={0.001} onChange={(value) => update({ weights: { ...config.weights, energy: value } })} format={(value) => value.toFixed(3)} />
            <Slider label="Upright bonus" value={config.weights.upright} min={0} max={3} onChange={(value) => update({ weights: { ...config.weights, upright: value } })} format={(value) => value.toFixed(2)} />
            <Slider label="Belly-drag penalty" value={config.weights.drag} min={0} max={1} onChange={(value) => update({ weights: { ...config.weights, drag: value } })} format={(value) => `${Math.round(value * 100)}% of distance`} />
            <div className="field">
              <label htmlFor="exp-seed">Seed {session ? '(set when the experiment started)' : ''}</label>
              <input id="exp-seed" className="input" type="number" min={1} value={session?.config.seed ?? config.seed} disabled={Boolean(session)} onChange={(event) => update({ seed: Math.max(1, Number(event.target.value) || 1) })} />
            </div>
          </>
        ) : null}
      </div>
    </section>
  )
}

function ChartsSection({ history, selected, onSelect, session, version }) {
  const generations = history.map((record) => record.generation)
  const ink = 'var(--ink)'
  const soft = 'var(--tick)'
  void version
  return (
    <section className="section" aria-labelledby="charts-title">
      <h2 className="section-title" id="charts-title">Measurements</h2>
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', marginBottom: 20 }} data-testid="evolve-stats">
        <Readout value={selected.generation} label="generation shown" />
        <Readout value={selected.populationSize} label="population" />
        <Readout value={fmt.m(selected.bestFitness)} label="best fitness" />
        <Readout value={fmt.m(selected.meanFitness)} label="mean fitness" />
        <Readout value={fmt.m(selected.medianFitness)} label="median fitness" />
        <Readout value={fmt.m(selected.bestDistance)} unit="m" label="best distance" />
        <Readout value={fmt.m(selected.meanDistance)} unit="m" label="mean distance" />
        <Readout value={fmt.pct(selected.mutationRate)} label="mutation rate" />
        <Readout value={fmt.pct(selected.survivalRate)} label="became parents" />
        <Readout value={String(selected.invalid)} label="invalid runs" />
      </div>
      <div className="chart-grid">
        <LineChart
          title="Fitness by generation"
          description="Click anywhere to inspect that generation."
          generations={generations}
          selected={selected.generation}
          onSelect={onSelect}
          band={{ low: history.map((r) => r.q1Fitness), high: history.map((r) => r.q3Fitness), color: 'var(--ground)' }}
          series={[{ name: 'mean', values: history.map((r) => r.meanFitness), color: soft }, { name: 'best', values: history.map((r) => r.bestFitness), color: ink }]}
        />
        <LineChart
          title="Distance by generation"
          description="How far creatures actually got, in metres."
          generations={generations}
          selected={selected.generation}
          onSelect={onSelect}
          unit=" m"
          series={[{ name: 'mean', values: history.map((r) => r.meanDistance), color: soft }, { name: 'best', values: history.map((r) => r.bestDistance), color: ink }]}
        />
        <Histogram title={`Generation ${selected.generation} against generation ${history[0].generation}`} description="How many creatures scored what. The outline is the first generation." values={selected.fitness} compare={selected === history[0] ? null : history[0].fitness} valueLabel={`generation ${selected.generation}`} compareLabel={`generation ${history[0].generation}`} />
        <Scatter title={`Effort against distance in generation ${selected.generation}`} description="Each dot is one creature." xs={selected.energies} ys={selected.distances} xLabel="work done (per body weight)" yLabel="distance (m)" highlight={0} />
        <LineChart title="Genetic diversity" description="Mean gene distance from the population average. A falling line means the population is converging." generations={generations} selected={selected.generation} onSelect={onSelect} series={[{ name: 'diversity', values: history.map((r) => r.diversity), color: ink }]} />
        <LineChart title="Evaluation time" description={`${session.evaluations} simulated runs so far, measured in this browser.`} generations={generations} selected={selected.generation} onSelect={onSelect} unit=" ms" series={[{ name: 'time', values: history.map((r) => r.evaluationMs), color: ink }]} />
      </div>
    </section>
  )
}

function HistorySection({ history, selected, onSelect, session }) {
  const clock = useMemo(() => new PlaybackClock({ loop: true, speed: 1 }), [])
  const [follow, setFollow] = useState('champion')
  const items = useMemo(() => (selected ? [{
    genome: selected.bestGenome,
    env: selected.env,
    duration: selected.duration,
    sim: makeSimSettings(session.config),
    key: `${session.id}:${selected.generation}`,
  }] : []), [selected, session])
  const { scene, error } = useRecordedScene(items, { layout: 'overlay', zoomScale: 1.25 })
  useClockLoop(clock, scene)
  const track = scene?.tracks[0]
  const verified = track && session.config.trials === 1 && track.metrics.stateHash === selected.bestMetrics.stateHash

  const save = async () => {
    const genome = { ...selected.bestGenome, name: `${session.ancestor?.name ?? 'creature'} g${selected.generation}` }
    try {
      await saveCreature(makeCreatureRecord(genome, { generation: selected.generation, fitness: selected.bestFitness, distance: selected.bestMetrics.distance, envId: selected.envId, objective: selected.objective }))
      toast(`Saved ${genome.name} to the gallery.`)
    } catch (err) {
      toast(err.message, { kind: 'error' })
    }
  }

  const branch = () => {
    const store = useSim.getState()
    const next = session.branchFrom(selected)
    store.attachSession(next)
    toast(`Started a new experiment from generation ${selected.generation}'s best.`)
    useApp.getState().navigate('simulate')
    store.startEvolution()
  }

  return (
    <section className="section" aria-labelledby="history-title">
      <h2 className="section-title" id="history-title">Generation history</h2>
      <p className="section-note">Choose a generation to replay its best creature. Replays run the physics again from the stored genome and check the result against the original run.</p>
      <div className="split">
        <div className="table-scroll" tabIndex={0} aria-label="Generations table">
          <table className="table" data-testid="history-table">
            <thead><tr><th>Generation</th><th className="num">Best fitness</th><th className="num">Mean</th><th className="num">Best distance</th><th className="num">Diversity</th></tr></thead>
            <tbody>
              {[...history].reverse().map((record) => (
                <tr key={record.generation} className="is-row" aria-selected={record.generation === selected?.generation} tabIndex={0} onClick={() => onSelect(record.generation)} onKeyDown={(event) => { if (event.key === 'Enter') onSelect(record.generation) }}>
                  <td>{record.generation}</td>
                  <td className="num">{record.bestFitness.toFixed(2)}</td>
                  <td className="num">{record.meanFitness.toFixed(2)}</td>
                  <td className="num">{record.bestDistance.toFixed(2)} m</td>
                  <td className="num">{record.diversity.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <div className="replay-stage" data-testid="replay-stage">
            <Arena scene={scene} clock={clock} follow={follow} trails primary onUserCamera={setFollow} label={`Replay of the best creature of generation ${selected?.generation}`} />
          </div>
          <ReplayControls clock={clock} showFollow follow={follow} onFollow={setFollow} />
          {error ? <p className="error-text">{error}</p> : null}
          {track ? (
            <p className="tag" data-testid="replay-verification" style={{ margin: '8px 0' }}>
              Generation {selected.generation}: {track.metrics.distance.toFixed(2)} m, seed {selected.seed}, {selected.envId}, {selected.controller}.{' '}
              {session.config.trials > 1 ? 'Averaged over several terrains, so this replay shows the first.' : verified ? 'This replay matches the original run exactly.' : 'This replay differs from the original run, which can happen if settings changed.'}
            </p>
          ) : null}
          <div className="row">
            <button type="button" className="btn" data-testid="save-generation" onClick={save}>Save to gallery</button>
            <button type="button" className="btn" data-testid="branch" onClick={branch}>Branch from here</button>
            <button type="button" className="btn btn-quiet" onClick={() => exportCreature(selected.bestGenome, { generation: selected.generation, fitness: selected.bestFitness })}>Export genome</button>
            <button type="button" className="btn btn-quiet" onClick={() => exportReplayMetadata(selected.bestGenome, selected.env, selected.duration, selected.bestMetrics)}>Export replay</button>
            <button type="button" className="btn btn-quiet" onClick={() => exportArenaScreenshot(document.querySelector('[data-testid="replay-stage"]'), `evolve-generation-${selected.generation}.png`)}>Screenshot</button>
          </div>
        </div>
      </div>
    </section>
  )
}

function CompareSection({ session, history }) {
  const [saved, setSaved] = useState([])
  useEffect(() => {
    listCreatures().then(({ creatures }) => setSaved(creatures)).catch(() => {})
  }, [])
  const last = history[history.length - 1]
  const first = history[0]
  const candidates = useMemo(() => {
    const list = history.filter((record, i) => i === 0 || i === history.length - 1 || record.generation % Math.max(1, Math.ceil(history.length / 40)) === 0).map((record) => ({
      id: `g${record.generation}`, label: `generation ${record.generation} best`, genome: record.bestGenome, env: record.env, duration: record.duration,
    }))
    if (last.parentGenome) list.push({ id: 'latest-parent', label: `parent of generation ${last.generation} best`, genome: last.parentGenome })
    if (last.medianGenome) list.push({ id: 'latest-median', label: `average of generation ${last.generation}`, genome: last.medianGenome })
    for (const creature of saved) list.push({ id: `c${creature.id}`, label: `saved: ${creature.name}`, genome: creature.genome })
    for (const preset of createPresets()) list.push({ id: `p${preset.name}`, label: `starter: ${preset.name}`, genome: preset })
    return list
  }, [history, saved, last])
  const [aId, setAId] = useState(null)
  const [bId, setBId] = useState(null)
  const a = candidates.find((item) => item.id === aId) ?? candidates.find((item) => item.id === `g${first.generation}`)
  const b = candidates.find((item) => item.id === bId) ?? candidates.find((item) => item.id === `g${last.generation}`)
  const env = session.config.env
  const duration = session.config.duration
  const items = useMemo(() => (a && b ? [
    { genome: a.genome, env, duration, label: a.label, key: a.id },
    { genome: b.genome, env, duration, label: b.label, key: b.id },
  ] : []), [a, b, env, duration])
  const narrow = typeof matchMedia !== 'undefined' && matchMedia('(max-width: 700px)').matches
  const { scene } = useRecordedScene(items, { layout: 'grid', columns: narrow ? 1 : 2 })
  const clock = useMemo(() => new PlaybackClock({ loop: true, speed: 1 }), [])
  useClockLoop(clock, scene)
  const [ta, tb] = scene?.tracks ?? []
  const options = candidates.map((item) => ({ value: item.id, label: item.label }))

  const rows = ta && tb ? [
    ['Distance', ta.metrics.distance, tb.metrics.distance, ' m'],
    ['Average speed', ta.metrics.avgSpeed, tb.metrics.avgSpeed, ' m/s'],
    ['Fastest 3 s', ta.metrics.bestSpeed, tb.metrics.bestSpeed, ' m/s'],
    ['Work done', ta.metrics.energy, tb.metrics.energy, ' J'],
    ['Time upright', ta.metrics.upright * 100, tb.metrics.upright * 100, '%'],
    ['Joint movement', ta.metrics.jointTravel, tb.metrics.jointTravel, ' rad'],
    ['Falls', ta.metrics.falls, tb.metrics.falls, ''],
    ['Mass', ta.metrics.mass, tb.metrics.mass, ' kg'],
    ['Rhythm', ta.genome.controller.frequency, tb.genome.controller.frequency, ' Hz'],
  ] : []

  return (
    <section className="section" aria-labelledby="compare-title">
      <h2 className="section-title" id="compare-title">Compare two creatures</h2>
      <p className="section-note">Both run on {env.id} with the same start and the same clock, in separate simulations.</p>
      <div className="row" style={{ marginBottom: 10 }}>
        <Select label="Left" value={a?.id ?? ''} onChange={setAId} options={options} testId="compare-a" />
        <Select label="Right" value={b?.id ?? ''} onChange={setBId} options={options} testId="compare-b" />
        <button type="button" className="btn btn-quiet" style={{ alignSelf: 'flex-end' }} onClick={() => { setAId(`g${first.generation}`); setBId(`g${last.generation}`) }}>First against latest</button>
        <button type="button" className="btn btn-quiet" style={{ alignSelf: 'flex-end' }} data-testid="compare-parent" disabled={!last.parentGenome} onClick={() => { setAId('latest-parent'); setBId(`g${last.generation}`) }}>Best against its parent</button>
        <button type="button" className="btn btn-quiet" style={{ alignSelf: 'flex-end' }} data-testid="compare-average" disabled={!last.medianGenome} onClick={() => { setAId('latest-median'); setBId(`g${last.generation}`) }}>Average against best</button>
      </div>
      <div className="compare-stage" data-testid="compare-stage">
        <Arena scene={scene} clock={clock} follow="champion" primary trails label="Two creatures side by side" />
      </div>
      <ReplayControls clock={clock} />
      <div className="split" style={{ marginTop: 14 }}>
        <div>
          <h3 style={{ marginBottom: 6 }}>Results</h3>
          <table className="table" data-testid="compare-table">
            <thead><tr><th>Measure</th><th className="num">Left</th><th className="num">Right</th></tr></thead>
            <tbody>
              {rows.map(([name, left, right, unit]) => <tr key={name}><td>{name}</td><td className="num">{left.toFixed(2)}{unit}</td><td className="num">{right.toFixed(2)}{unit}</td></tr>)}
              <tr><td>Controller</td><td className="num">{ta?.genome.controller.type}</td><td className="num">{tb?.genome.controller.type}</td></tr>
            </tbody>
          </table>
        </div>
        <div>
          <h3 style={{ marginBottom: 6 }}>Largest gene differences</h3>
          {ta && tb ? <GeneDiff a={ta.genome} b={tb.genome} /> : null}
        </div>
      </div>
    </section>
  )
}

function GeneDiff({ a, b }) {
  const diffs = useMemo(() => {
    const genesA = new Map(listGenes(a).map((gene) => [gene.key, gene]))
    const out = []
    for (const gene of listGenes(b)) {
      const other = genesA.get(gene.key)
      if (!other) continue
      const valueA = other.holder[other.field]
      const valueB = gene.holder[gene.field]
      const change = Math.abs(valueA - valueB) / (gene.max - gene.min || 1)
      if (change > 1e-6) out.push({ key: gene.key, valueA, valueB, change })
    }
    return out.sort((x, y) => y.change - x.change).slice(0, 8)
  }, [a, b])
  if (a.segments.length !== b.segments.length) return <p className="tag">These bodies have different structures ({a.segments.length} and {b.segments.length} segments), so only their shared genes are compared.</p>
  if (!diffs.length) return <p className="tag">These two genomes are identical.</p>
  return (
    <table className="table diff-table" data-testid="gene-diff">
      <thead><tr><th>Gene</th><th className="num">Left</th><th className="num">Right</th></tr></thead>
      <tbody>{diffs.map((diff) => <tr key={diff.key}><td>{describeGene(diff.key)}</td><td className="num">{diff.valueA.toFixed(3)}</td><td className="num">{diff.valueB.toFixed(3)}</td></tr>)}</tbody>
    </table>
  )
}

const GENE_NAMES = { w: 'length', h: 'thickness', density: 'density', friction: 'friction', 'anchorP.u': 'attachment along', 'anchorP.v': 'attachment across', rest: 'rest angle', lower: 'lower limit', upper: 'upper limit', maxTorque: 'motor strength', maxSpeed: 'motor speed', gain: 'motor response', amp: 'swing', phase: 'timing', offset: 'centre angle' }

function describeGene(key) {
  if (key === 'frequency') return 'rhythm'
  if (key.startsWith('w')) {
    const index = key.slice(1)
    if (/^\d+$/.test(index)) return `neural weight ${index}`
  }
  const [segment, ...rest] = key.split('.')
  const index = Number(segment.slice(1))
  return `${index === 0 ? 'body' : `segment ${index + 1}`}: ${GENE_NAMES[rest.join('.')] ?? rest.join('.')}`
}

function SavedExperiments() {
  const [items, setItems] = useState(null)
  const session = useSim((state) => state.session)
  const refresh = () => listExperiments().then(setItems).catch(() => setItems([]))
  useEffect(() => {
    refresh()
  }, [session])
  if (!items || !items.length) return null
  const open = async (id) => {
    try {
      const loaded = await loadExperiment(id)
      if (!loaded) throw new Error('That experiment is no longer saved.')
      const restored = EvolutionSession.fromCheckpoint(loaded.checkpoint, loaded.history, { pool: getPool() })
      useSim.getState().restoreSession(restored)
      toast(`Restored "${restored.name}" at generation ${restored.generation}.`)
    } catch (error) {
      toast(`Could not restore that experiment: ${error.message}`, { kind: 'error' })
    }
  }
  const remove = async (id, name) => {
    if (!window.confirm(`Delete "${name}" and its history? This cannot be undone.`)) return
    await deleteExperiment(id)
    refresh()
  }
  return (
    <section className="section" aria-labelledby="saved-title">
      <h2 className="section-title" id="saved-title">Saved experiments</h2>
      <p className="section-note">Checkpoints save automatically every five generations. Restoring continues from the latest checkpoint.</p>
      <table className="table" data-testid="saved-experiments">
        <thead><tr><th>Name</th><th className="num">Generation</th><th>Environment</th><th /></tr></thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>{item.name}{item.id === session?.id ? ' (running now)' : ''}</td>
              <td className="num">{item.generation}</td>
              <td>{item.config?.env?.id}</td>
              <td className="num">
                <button type="button" className="btn btn-quiet" disabled={item.id === session?.id} data-testid="restore-experiment" onClick={() => open(item.id)}>Restore</button>
                <button type="button" className="btn btn-quiet" onClick={() => remove(item.id, item.name)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function HonestySection() {
  return (
    <section className="section" aria-labelledby="honest-title">
      <h2 className="section-title" id="honest-title">What this does and does not show</h2>
      <div className="page-lede" style={{ marginTop: 6 }}>
        <p>This is artificial evolution: a genetic algorithm searching over simulated bodies and controllers. It is not a model of biological evolution.</p>
        <p style={{ marginTop: 8 }}>Fitness is whatever the selected score says, so creatures may satisfy it in ways you did not intend. The physics is an approximation. The process is random, and one run proves little: improvement is not guaranteed in any generation, and populations often converge early on a mediocre gait. Neural controllers here are small and simplified.</p>
      </div>
    </section>
  )
}
