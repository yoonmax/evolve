// Races. Every racer is simulated alone on the same terrain with the same start, so
// nobody can trip anybody; lanes only display them together.
import { useEffect, useMemo, useRef, useState } from 'react'
import gsap from 'gsap'
import Arena from '../components/Arena.jsx'
import Thumb from '../components/Thumb.jsx'
import { Select } from '../components/ui.jsx'
import ReplayControls from '../replay/ReplayControls.jsx'
import { recordRun } from '../evolution/EvaluationManager.js'
import { createPresets } from '../creatures/CreaturePresets.js'
import { EVOLVED_EXAMPLES } from '../creatures/evolvedExamples.js'
import { makeTrack, comAt } from '../rendering/Track.js'
import { PlaybackClock } from '../rendering/PlaybackClock.js'
import { ENVIRONMENTS } from '../physics/Environments.js'
import { getPool } from '../workers/WorkerPool.js'
import { listCreatures } from '../storage/CreatureRepository.js'
import { useSim } from '../state/simulationStore.js'
import { genomeHash } from '../creatures/Genome.js'
import { rankRacers } from '../statistics/raceResults.js'
import { loadKv, saveKv } from '../storage/ExperimentRepository.js'
import { useApp, announce, toast } from '../state/applicationStore.js'

const RACE_SECONDS = 30
const MAX_RACERS = 8
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches

export default function CompetePage() {
  const session = useSim((state) => state.session)
  const version = useSim((state) => state.version)
  const query = useApp((state) => state.query)
  const [saved, setSaved] = useState([])
  const [picked, setPicked] = useState([])
  const [envId, setEnvId] = useState('flat')
  const [finish, setFinish] = useState(20)
  const [race, setRace] = useState(null)
  const [count, setCount] = useState(null)
  const [done, setDone] = useState(false)
  const [running, setRunning] = useState(false)
  const [standings, setStandings] = useState([])
  const clock = useMemo(() => new PlaybackClock({ loop: false, speed: 1, playing: false }), [])
  const winnerRef = useRef(null)
  const boardRef = useRef(null)
  const bests = useRef({})
  const standingsKey = useRef('')

  useEffect(() => {
    listCreatures().then(({ creatures }) => {
      setSaved(creatures)
    }).catch(() => {})
    const include = query.get('racer')
    if (include) setPicked((current) => (current.includes(include) ? current : [...current, include]))
    loadKv('raceBests', {}).then((value) => { bests.current = value ?? {} })
    // query only matters on arrival
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const candidates = useMemo(() => {
    const list = []
    const history = session?.history ?? []
    if (history.length) {
      const last = history[history.length - 1]
      list.push({ id: 'live-latest', name: `generation ${last.generation} best`, genome: last.bestGenome })
      if (history.length > 1) list.push({ id: 'live-first', name: 'generation 1 best', genome: history[0].bestGenome })
    }
    for (const item of saved) list.push({ id: `saved:${item.id}`, name: item.name, genome: item.genome })
    for (const item of EVOLVED_EXAMPLES) list.push({ id: `example:${item.name}`, name: item.name, genome: item })
    for (const item of createPresets()) list.push({ id: `preset:${item.name}`, name: item.name, genome: item })
    return list
  // version: live history mutates in place
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, saved, version])

  const toggle = (id) => {
    setPicked((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id)
      if (current.length >= MAX_RACERS) return current
      return [...current, id]
    })
  }

  const racers = picked.map((id) => candidates.find((item) => item.id === id)).filter(Boolean)
  const env = useMemo(() => ({ id: envId, seed: 7 }), [envId])

  const startRace = async () => {
    setRunning(true)
    setDone(false)
    setCount(null)
    clock.set({ playing: false })
    clock.load(0)
    try {
      const pool = getPool()
      const runs = await Promise.all(racers.map((racer) => recordRun(racer.genome, env, pool, { duration: RACE_SECONDS, finishLine: finish, group: 'race' })))
      const tracks = runs.map((run, i) => makeTrack(run, { label: racers[i].name, role: 'racer' }))
      setRace({ tracks, env, layout: 'lanes', finishLine: finish, rulerOrigin: 0, heroIndex: 0, selected: 0 })
      const finishes = tracks.map((track) => (track.metrics.finishTime !== null ? track.metrics.finishTime + 0.5 : Infinity))
      const lastFinish = Math.max(...finishes.filter(Number.isFinite), 0)
      const anyFinish = finishes.some(Number.isFinite)
      const allFinish = finishes.every(Number.isFinite)
      // Stop soon after the last finisher; if some never finish, give them their full time.
      clock.load(allFinish ? Math.min(RACE_SECONDS + 0.5, lastFinish + 1.5) : anyFinish ? Math.min(RACE_SECONDS + 0.5, lastFinish + 6) : RACE_SECONDS + 0.5, { frameDt: tracks[0].recording.frameDt })
      await countdown()
      clock.set({ playing: true, loop: false, speed: 1 })
      const off = clock.onEnd(() => {
        off()
        setDone(true)
        setRunning(false)
        reveal(tracks)
      })
    } catch (error) {
      toast(error.message, { kind: 'error' })
      setRunning(false)
    }
  }

  const countdown = () => new Promise((resolve) => {
    if (reduced()) {
      resolve()
      return
    }
    const steps = ['3', '2', '1']
    let i = 0
    const next = () => {
      if (i >= steps.length) {
        setCount(null)
        resolve()
        return
      }
      setCount(steps[i++])
      setTimeout(next, 620)
    }
    next()
  })

  const reveal = (tracks) => {
    const ranked = rankRacers(tracks)
    const winner = ranked[0]
    const key = (track) => `${genomeHash(track.genome)}:${envId}:${finish}`
    const updated = { ...bests.current }
    for (const { track, finish: time, distance } of ranked) {
      const score = time !== null ? -time : distance - 100000
      const previous = updated[key(track)]
      if (previous === undefined || score > previous) {
        track.personalBest = previous !== undefined
        updated[key(track)] = score
      }
    }
    bests.current = updated
    saveKv('raceBests', updated).catch(() => {})
    setStandings(ranked.map(({ track, index }) => ({ index, name: track.label, x: comAt(track, 0).x })))
    announce(`${winner.track.label} wins${winner.finish !== null ? ` in ${winner.finish.toFixed(2)} seconds` : `, reaching ${winner.distance.toFixed(1)} metres`}.`)
  }

  useEffect(() => {
    if (done && winnerRef.current && !reduced()) {
      gsap.fromTo(winnerRef.current, { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, ease: 'power3.out' })
    }
    if (done && boardRef.current && !reduced()) {
      gsap.fromTo(boardRef.current.querySelectorAll('li'), { x: 10, opacity: 0 }, { x: 0, opacity: 1, duration: 0.3, stagger: 0.05, ease: 'power2.out' })
    }
  }, [done])

  // Live order, read from physics positions at the current playback time.
  const onFrame = (time) => {
    if (!race || done) return
    const order = race.tracks
      .map((track, index) => ({ index, name: track.label, x: comAt(track, time).x }))
      .sort((a, b) => b.x - a.x)
    const key = order.map((row) => row.index).join(',')
    if (key !== standingsKey.current) {
      standingsKey.current = key
      setStandings(order)
    }
  }

  const ranked = race && done ? rankRacers(race.tracks) : null

  return (
    <>
      <div className="control-bar" role="toolbar" aria-label="Race setup">
        <Select hideLabel label="Race environment" value={envId} onChange={setEnvId} options={ENVIRONMENTS.map((item) => ({ value: item.id, label: item.name }))} testId="race-env" />
        <Select hideLabel label="Finish distance" value={String(finish)} onChange={(value) => setFinish(Number(value))} options={[10, 20, 40, 80].map((value) => ({ value: String(value), label: `${value} m race` }))} testId="race-finish" />
        <button type="button" className="btn btn-primary" data-testid="start-race" disabled={racers.length < 2 || running} onClick={startRace}>{race && done ? 'Race again' : 'Start race'}</button>
        <span className="tag">{racers.length < 2 ? 'Pick at least two racers.' : `${racers.length} racers. Each is simulated alone, so they cannot collide.`}</span>
      </div>
      {!race ? (
        <div className="page" data-testid="compete-page">
          <h1 className="page-title">Pick your racers</h1>
          <p className="page-lede" style={{ marginBottom: 16 }}>Choose two to eight creatures. Same terrain, same start. Save evolved creatures from an experiment to enter them here.</p>
          <RacerPicker candidates={candidates} picked={picked} toggle={toggle} />
        </div>
      ) : (
        <>
          <Arena scene={race} clock={clock} follow="leader" primary trails onFrame={onFrame} label={`Race: ${racers.map((racer) => racer.name).join(', ')}`}>
            {count ? <div className="countdown" data-testid="countdown">{count}</div> : null}
            <aside className="leaderboard" ref={boardRef} aria-label="Leaderboard" data-testid="leaderboard">
              <strong>{done ? 'Final order' : 'Current order'}</strong>
              <ol>
                {(ranked ?? standings.map((row) => ({ index: row.index, track: race.tracks[row.index], finish: null, distance: null }))).map((row, position) => (
                  <li key={row.index}>
                    <span>{position + 1}. {row.track.label}</span>
                    <span>{done ? (row.finish !== null ? `${row.finish.toFixed(2)} s` : `${row.distance.toFixed(1)} m`) : ''}{done && row.track.personalBest ? ', new best' : ''}</span>
                  </li>
                ))}
              </ol>
            </aside>
            {ranked ? (
              <div className="winner" ref={winnerRef} data-testid="winner">
                <b>{ranked[0].track.label}</b>
                <span className="tag">{ranked[0].finish !== null ? `won in ${ranked[0].finish.toFixed(2)} s` : `got furthest, ${ranked[0].distance.toFixed(1)} m; nobody finished`}</span>
              </div>
            ) : null}
          </Arena>
          <ReplayControls clock={clock} extra={(
            <button type="button" className="btn btn-quiet" data-testid="change-racers" onClick={() => { setRace(null); setDone(false); clock.set({ playing: false }) }}>Change racers</button>
          )} />
        </>
      )}
    </>
  )
}

function RacerPicker({ candidates, picked, toggle }) {
  return (
    <div className="race-picks" style={{ maxHeight: 'none' }} role="group" aria-label="Racers">
      {candidates.map((candidate) => (
        <button key={candidate.id} type="button" className="race-pick" data-testid={`racer-${candidate.id}`} aria-pressed={picked.includes(candidate.id)} onClick={() => toggle(candidate.id)}>
          <Thumb genome={candidate.genome} />
          <span>{candidate.name}</span>
        </button>
      ))}
    </div>
  )
}
