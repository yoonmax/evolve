// Test run: the edited genome, simulated in a worker and played back with its real
// measurements. It re-simulates whenever the creature changes.
import { useEffect, useMemo, useRef, useState } from 'react'
import Arena from '../components/Arena.jsx'
import { Readout, Select, Toggle } from '../components/ui.jsx'
import ReplayControls, { useClockLoop } from '../replay/ReplayControls.jsx'
import { useRecordedScene } from '../replay/useRecordedScene.js'
import { ENVIRONMENTS } from '../physics/Environments.js'
import { PlaybackClock } from '../rendering/PlaybackClock.js'
import { sampleScalars } from '../rendering/Track.js'

const OVERLAYS = [
  ['shapes', 'collision shapes'],
  ['joints', 'joint anchors'],
  ['motors', 'motor activation'],
  ['contacts', 'contact points'],
  ['forces', 'contact forces'],
  ['com', 'centre of mass'],
]

export default function TestRunPanel({ genome, onClose }) {
  const [envId, setEnvId] = useState('flat')
  const [overlays, setOverlays] = useState({})
  const [follow, setFollow] = useState('champion')
  const [debounced, setDebounced] = useState(genome)
  const clock = useMemo(() => new PlaybackClock({ loop: true, speed: 1 }), [])
  const refs = useRef({})

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(genome), 220)
    return () => clearTimeout(timer)
  }, [genome])

  const items = useMemo(() => [{ genome: debounced, env: { id: envId, seed: 7 }, duration: 15, key: JSON.stringify(debounced) }], [debounced, envId])
  const { scene, error, loading } = useRecordedScene(items, { layout: 'overlay', zoomScale: 1.7 })
  useClockLoop(clock, scene)

  const debug = Object.values(overlays).some(Boolean) ? overlays : null
  const onFrame = (time) => {
    const track = scene?.tracks[0]
    if (!track) return
    const scalars = sampleScalars(track, time)
    const r = refs.current
    if (r.distance) r.distance.textContent = scalars.distance.toFixed(2)
    if (r.speed) r.speed.textContent = scalars.speed.toFixed(2)
    if (r.energy) r.energy.textContent = scalars.energy.toFixed(0)
    if (r.angle) r.angle.textContent = `${Math.round((scalars.angle * 180) / Math.PI)}°`
    if (r.time) r.time.textContent = scalars.time.toFixed(1)
    if (r.contact) r.contact.textContent = countBits(scalars.contacts)
    const recording = track.recording
    if (r.meters && recording.detail) {
      const nodes = r.meters.children
      for (let j = 0; j < nodes.length; j++) {
        const torque = Math.abs(recording.torques[scalars.frame * recording.jointCount + j])
        const limit = genome.segments[j + 1]?.joint?.maxTorque ?? 1
        nodes[j].firstChild.style.height = `${Math.min(100, (torque / limit) * 100)}%`
      }
    }
  }

  const invalid = scene?.tracks[0]?.metrics.invalid

  return (
    <section className="test-panel" aria-label="Test run" data-testid="test-panel">
      <Arena scene={scene} clock={clock} follow={follow} debug={debug} trails onFrame={onFrame} primary onUserCamera={setFollow} label={`Test run of ${genome.name}`}>
        <div className="test-stats" data-testid="test-stats">
          <Readout valueRef={(node) => { refs.current.distance = node }} value="0.00" unit="m" label="distance" />
          <Readout valueRef={(node) => { refs.current.speed = node }} value="0.00" unit="m/s" label="speed" />
          <Readout className="hide-small" valueRef={(node) => { refs.current.angle = node }} value="0°" label="body angle" />
          <Readout className="hide-small" valueRef={(node) => { refs.current.energy = node }} value="0" unit="J" label="work done" />
          <Readout className="hide-small" valueRef={(node) => { refs.current.contact = node }} value="0" label="parts on ground" />
          <Readout valueRef={(node) => { refs.current.time = node }} value="0.0" unit="s" label="elapsed" />
        </div>
        <div className="joint-meters" aria-hidden="true" ref={(node) => { refs.current.meters = node }} title="Motor effort per joint">
          {genome.segments.slice(1).map((segment) => <span key={segment.id}><i /></span>)}
        </div>
        {invalid ? <div className="arena-note error-text">This run stopped: {invalid}. Fix the creature, or evolution will penalise it.</div> : null}
        {error ? <div className="arena-note error-text">{error}</div> : null}
        {loading && !scene ? <div className="arena-note">Simulating…</div> : null}
      </Arena>
      <ReplayControls clock={clock} showFollow follow={follow} onFollow={setFollow} extra={(
        <>
          <Select hideLabel label="Test environment" value={envId} onChange={setEnvId} options={ENVIRONMENTS.map((env) => ({ value: env.id, label: env.name }))} testId="test-env" />
          <details className="overlay-menu">
            <summary className="btn btn-quiet">Overlays</summary>
            <div className="overlay-list">
              {OVERLAYS.map(([key, label]) => <Toggle key={key} label={label} checked={Boolean(overlays[key])} onChange={(value) => setOverlays({ ...overlays, [key]: value })} />)}
            </div>
          </details>
          <button type="button" className="btn btn-quiet" onClick={onClose}>Close</button>
        </>
      )} />
    </section>
  )
}

function countBits(mask) {
  let count = 0
  let value = mask
  while (value) {
    count += value & 1
    value >>>= 1
  }
  return count
}
