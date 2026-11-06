// Controlled experiments across seeds, with aggregate results.
import { useEffect, useMemo, useRef, useState } from 'react'
import Arena from '../components/Arena.jsx'
import { Select, Slider } from '../components/ui.jsx'
import { niceTicks } from '../statistics/EvolutionCharts.jsx'
import ReplayControls, { useClockLoop } from '../replay/ReplayControls.jsx'
import { useRecordedScene } from '../replay/useRecordedScene.js'
import { PlaybackClock } from '../rendering/PlaybackClock.js'
import { VARIABLES, evaluationsPlanned, getVariable, runExperimentPlan } from '../experiments/ExperimentRunner.js'
import { createPresets } from '../creatures/CreaturePresets.js'
import { ENVIRONMENTS } from '../physics/Environments.js'
import { getPool } from '../workers/WorkerPool.js'
import { CancelledError } from '../workers/WorkerPool.js'
import { loadKv, saveKv } from '../storage/ExperimentRepository.js'
import { exportExperimentConfig } from '../export/StatisticsExporter.js'
import { downloadText } from '../export/GenomeExporter.js'
import { toast } from '../state/applicationStore.js'
import { listCreatures } from '../storage/CreatureRepository.js'

// Fixed hue order per arm, validated for colour-vision separation on both themes;
// each arm is also labelled directly on the chart, so colour is never the only cue.
const ARM_COLORS = ['#1C7263', '#B5832A', '#6A5BA8', '#2E6FA8', '#A23D6D', '#5F6B3A', '#3A3D42']
const ARM_COLORS_DARK = ['#63C2AC', '#D5AB57', '#A99BE6', '#7DB3E0', '#E08AB4', '#B3C27A', '#D0CDC4']

function armColor(index) {
  const dark = document.documentElement.dataset.theme === 'dark'
  return (dark ? ARM_COLORS_DARK : ARM_COLORS)[index % ARM_COLORS.length]
}

export default function ExperimentsPage() {
  const presets = useMemo(() => createPresets(), [])
  const [saved, setSaved] = useState([])
  const [creature, setCreature] = useState('trestle')
  const [variableId, setVariableId] = useState('mutationRate')
  const [values, setValues] = useState(getVariable('mutationRate').defaults)
  const [generations, setGenerations] = useState(15)
  const [seeds, setSeeds] = useState(3)
  const [populationSize, setPopulationSize] = useState(20)
  const [envId, setEnvId] = useState('flat')
  const [baseSeed, setBaseSeed] = useState(1)
  const [progress, setProgress] = useState(null)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const runState = useRef({ cancelled: false, sessions: [] })

  useEffect(() => {
    listCreatures().then(({ creatures }) => setSaved(creatures)).catch(() => {})
    loadKv('labResult').then((stored) => { if (stored) setResult(stored) })
  }, [])

  const variable = getVariable(variableId)
  const setup = { variable: variableId, values, generations, seeds, populationSize, env: { id: envId, seed: 7 }, baseSeed, base: {} }
  const planned = evaluationsPlanned(setup)
  const candidates = [...presets.map((genome) => ({ value: genome.name, label: genome.name, genome })), ...saved.map((item) => ({ value: `saved:${item.id}`, label: `saved: ${item.name}`, genome: item.genome }))]
  const ancestor = candidates.find((item) => item.value === creature)?.genome ?? presets[0]

  const start = async () => {
    const pool = getPool()
    runState.current = { cancelled: false, sessions: [] }
    setError(null)
    setResult(null)
    setProgress({ done: 0, total: values.length * seeds * generations })
    const startedAt = performance.now()
    try {
      const output = await runExperimentPlan(setup, ancestor, pool, {
        onProgress: setProgress,
        isCancelled: () => runState.current.cancelled,
        register: (session) => runState.current.sessions.push(session),
      })
      const finished = { ...output, setup, ancestorName: ancestor.name, variableName: variable.name, seconds: (performance.now() - startedAt) / 1000, finishedAt: Date.now() }
      setResult(finished)
      saveKv('labResult', finished).catch(() => {})
      if (output.cancelled) toast('Experiment stopped. Results so far are shown.')
    } catch (err) {
      if (!(err instanceof CancelledError)) setError(err.message)
    } finally {
      setProgress(null)
    }
  }

  const stop = () => {
    runState.current.cancelled = true
    for (const session of runState.current.sessions) session.cancel()
  }

  const toggleValue = (value) => {
    setValues((current) => (current.includes(value) ? (current.length > 1 ? current.filter((item) => item !== value) : current) : [...current, value]))
  }

  return (
    <div className="page" data-testid="experiments-page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Experiments</h1>
          <p className="page-lede">Change one thing, keep the rest the same, and repeat across seeds. A single run of a random process tells you very little, so every arm here runs several times.</p>
        </div>
      </div>

      <section className="section" aria-label="Experiment setup">
        <div className="form-grid">
          <Select label="Creature" value={creature} onChange={setCreature} options={candidates} testId="lab-creature" />
          <Select label="What to vary" value={variableId} onChange={(id) => { setVariableId(id); setValues(getVariable(id).defaults) }} options={VARIABLES.map((item) => ({ value: item.id, label: item.name }))} testId="lab-variable" />
          {variableId !== 'terrain' ? <Select label="Environment" value={envId} onChange={setEnvId} options={ENVIRONMENTS.map((item) => ({ value: item.id, label: item.name }))} /> : null}
          <Slider label="Generations" value={generations} min={3} max={100} step={1} onChange={setGenerations} format={String} />
          <Slider label="Seeds per arm" value={seeds} min={1} max={10} step={1} onChange={setSeeds} format={String} />
          {variableId !== 'populationSize' ? <Slider label="Population" value={populationSize} min={6} max={100} step={2} onChange={setPopulationSize} format={String} /> : null}
          <div className="field">
            <label htmlFor="lab-seed">Base seed</label>
            <input id="lab-seed" className="input" type="number" min={1} value={baseSeed} onChange={(event) => setBaseSeed(Math.max(1, Number(event.target.value) || 1))} />
          </div>
        </div>
        <div className="field" style={{ marginTop: 12 }}>
          <span className="field-label">Values to compare</span>
          <div className="row" role="group" aria-label="Values to compare">
            {variable.options.map((option) => (
              <button key={option.value} type="button" className={`btn ${values.includes(option.value) ? 'btn-primary' : ''}`} aria-pressed={values.includes(option.value)} onClick={() => toggleValue(option.value)}>{option.label}</button>
            ))}
          </div>
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          {progress ? (
            <button type="button" className="btn" data-testid="lab-stop" onClick={stop}>Stop</button>
          ) : (
            <button type="button" className="btn btn-primary" data-testid="lab-run" onClick={start}>Run experiment</button>
          )}
          <span className="tag" data-testid="lab-status" role="status">
            {progress
              ? `${progress.done} of ${progress.total} generations${progress.arm ? `: ${progress.arm}, seed ${progress.seed}` : ''}`
              : `${values.length} arms, ${seeds} seeds each: about ${planned.toLocaleString()} simulated runs`}
          </span>
          <button type="button" className="btn btn-quiet" onClick={() => exportExperimentConfig(setup, 'lab')}>Export settings</button>
        </div>
        {error ? <p className="error-text">{error}</p> : null}
      </section>

      {result ? <Results result={result} /> : null}
    </div>
  )
}

function Results({ result }) {
  const arms = result.arms.filter((arm) => arm.summary)
  const generations = Math.max(1, ...arms.map((arm) => arm.summary.meanCurve.length))
  const clock = useMemo(() => new PlaybackClock({ loop: true, speed: 1 }), [])
  const items = useMemo(() => arms.map((arm) => {
    const best = arm.runs.reduce((a, b) => (b.bestFitness > a.bestFitness ? b : a))
    const variable = getVariable(result.setup.variable)
    const env = variable.id === 'gravity' ? { ...result.setup.env, gravity: Number(arm.value) } : variable.id === 'terrain' ? { ...result.setup.env, id: arm.value } : result.setup.env
    return { genome: best.bestGenome, env, duration: 12, label: arm.label, key: `${result.finishedAt}:${arm.value}` }
  }), [arms, result])
  const { scene } = useRecordedScene(items, { layout: 'grid' })
  useClockLoop(clock, scene)
  if (!arms.length) return <section className="section"><p className="tag">The experiment stopped before any generation finished.</p></section>
  const spreadOverlap = arms.length > 1 && arms.every((arm) => arms.every((other) => arm === other || (arm.summary.finalMin <= other.summary.finalMax && other.summary.finalMin <= arm.summary.finalMax)))
  const ranked = [...arms].sort((a, b) => b.summary.finalMean - a.summary.finalMean)

  const exportResults = () => downloadText(JSON.stringify({ kind: 'evolve/experiment-results', ...result }, null, 1), `evolve-lab-${result.finishedAt}.json`)

  return (
    <>
      <section className="section" aria-labelledby="lab-results">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 className="section-title" id="lab-results">Best distance by {result.variableName}</h2>
          <button type="button" className="btn btn-quiet" onClick={exportResults}>Export results</button>
        </div>
        <p className="section-note" data-testid="lab-summary">
          {result.ancestorName}, {result.setup.seeds} seeds per arm, {result.evaluations.toLocaleString()} simulated runs in {result.seconds?.toFixed(1)} s.{' '}
          {arms.length < 2
            ? ''
            : spreadOverlap
              ? 'The ranges overlap across seeds, so these results do not separate the arms. Try more seeds.'
              : `${ranked[0].label} finished highest on average in this run. With this few seeds, treat that as a lead to check rather than a conclusion.`}
        </p>
        <ArmChart arms={arms} generations={generations} />
      </section>
      <section className="section" aria-labelledby="lab-table">
        <h2 className="section-title" id="lab-table">Results by arm</h2>
        <div className="table-scroll">
          <table className="table" data-testid="lab-table-el">
            <thead><tr><th>Arm</th><th className="num">Final best, mean</th><th className="num">Spread across seeds</th><th className="num">Generations to 90%</th><th className="num">End diversity</th><th className="num">Invalid runs</th></tr></thead>
            <tbody>
              {arms.map((arm) => (
                <tr key={arm.value}>
                  <td>{arm.label}</td>
                  <td className="num">{arm.summary.finalMean.toFixed(2)} m</td>
                  <td className="num">{arm.summary.finalMin.toFixed(2)} to {arm.summary.finalMax.toFixed(2)} m</td>
                  <td className="num">{arm.summary.convergence.toFixed(1)}</td>
                  <td className="num">{arm.summary.diversityEnd.toFixed(3)}</td>
                  <td className="num">{(arm.summary.invalidRate * 100).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="section" aria-labelledby="lab-behaviour">
        <h2 className="section-title" id="lab-behaviour">What each arm evolved</h2>
        <p className="section-note">The best creature from each arm, re-simulated. The numbers measure distance; watching shows how it was achieved.</p>
        <div className="compare-stage" data-testid="lab-stage"><Arena scene={scene} clock={clock} follow="champion" primary label="Best creature from each arm" /></div>
        <ReplayControls clock={clock} />
      </section>
    </>
  )
}

function ArmChart({ arms, generations }) {
  const W = 760
  const H = 300
  const M = { left: 44, right: 110, top: 12, bottom: 26 }
  const [hover, setHover] = useState(null)
  const all = arms.flatMap((arm) => [...arm.summary.lowCurve, ...arm.summary.highCurve])
  const min = Math.min(0, ...all)
  const max = Math.max(0.5, ...all) * 1.05
  const xAt = (g) => M.left + (generations > 1 ? g / (generations - 1) : 0) * (W - M.left - M.right)
  const yAt = (value) => M.top + (1 - (value - min) / (max - min)) * (H - M.top - M.bottom)
  const line = (values) => values.map((value, g) => `${g ? 'L' : 'M'}${xAt(g).toFixed(1)} ${yAt(value).toFixed(1)}`).join('')
  const ticks = niceTicks(min, max, 5)
  // Direct labels at the line ends, pushed apart so that close finishes stay readable.
  const labels = arms
    .map((arm, index) => ({ index, y: yAt(arm.summary.meanCurve[arm.summary.meanCurve.length - 1]) + 4 }))
    .sort((a, b) => a.y - b.y)
  for (let i = 1; i < labels.length; i++) labels[i].y = Math.max(labels[i].y, labels[i - 1].y + 14)
  const labelY = new Map(labels.map((label) => [label.index, label.y]))
  return (
    <figure className="chart arm-chart" style={{ margin: 0 }}>
      <p className="chart-sub">{hover !== null ? `generation ${hover + 1}: ${arms.map((arm) => `${arm.label} ${arm.summary.meanCurve[Math.min(hover, arm.summary.meanCurve.length - 1)].toFixed(2)} m`).join(', ')}` : 'Lines are means across seeds; shaded bands run from the worst seed to the best.'}</p>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Best distance by generation: ${arms.map((arm) => `${arm.label} ended at ${arm.summary.finalMean.toFixed(2)} metres`).join(', ')}.`}
        onPointerMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          const x = ((event.clientX - rect.left) / rect.width) * W
          setHover(Math.max(0, Math.min(generations - 1, Math.round(((x - M.left) / (W - M.left - M.right)) * (generations - 1)))))
        }}
        onPointerLeave={() => setHover(null)}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line className="grid" x1={M.left} x2={W - M.right} y1={yAt(tick)} y2={yAt(tick)} />
            <text x={M.left - 6} y={yAt(tick) + 4} textAnchor="end">{tick}</text>
          </g>
        ))}
        <text x={M.left} y={H - 7}>1</text>
        <text x={W - M.right} y={H - 7} textAnchor="end">{generations}</text>
        {arms.map((arm, index) => {
          const summary = arm.summary
          const color = armColor(index)
          const band = `${line(summary.highCurve)}${summary.lowCurve.map((_, g) => `L${xAt(summary.lowCurve.length - 1 - g).toFixed(1)} ${yAt(summary.lowCurve[summary.lowCurve.length - 1 - g]).toFixed(1)}`).join('')}Z`
          const end = summary.meanCurve.length - 1
          return (
            <g key={arm.value}>
              <path d={band} fill={color} opacity={0.1} />
              <path d={line(summary.meanCurve)} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
              <text x={xAt(end) + 8} y={labelY.get(index)} style={{ fill: 'var(--ink)' }}>{arm.label}</text>
            </g>
          )
        })}
        {hover !== null ? <line x1={xAt(hover)} x2={xAt(hover)} y1={M.top} y2={H - M.bottom} stroke="var(--ink-soft)" strokeDasharray="3 3" /> : null}
      </svg>
      <div className="legend">{arms.map((arm, index) => <span key={arm.value}><i style={{ background: armColor(index) }} />{arm.label}</span>)}</div>
    </figure>
  )
}
