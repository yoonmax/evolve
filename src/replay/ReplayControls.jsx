import { useEffect, useRef, useState } from 'react'
import { IconButton, Select } from '../components/ui.jsx'

const SPEEDS = [0.1, 0.25, 0.5, 1, 2, 4, 8]

export default function ReplayControls({ clock, extra, showFollow, follow, onFollow }) {
  const [, force] = useState(0)
  const scrubRef = useRef(null)
  const timeRef = useRef(null)

  // Time moves every frame, so these nodes update directly rather than through React.
  useEffect(() => {
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      if (scrubRef.current && document.activeElement !== scrubRef.current) scrubRef.current.value = clock.time
      if (timeRef.current) timeRef.current.textContent = `${clock.time.toFixed(2)} / ${clock.duration.toFixed(1)} s`
    }
    raf = requestAnimationFrame(tick)
    const off = clock.subscribe(() => force((value) => value + 1))
    return () => {
      cancelAnimationFrame(raf)
      off()
    }
  }, [clock])

  return (
    <div className="replay-bar" role="toolbar" aria-label="Replay controls">
      <IconButton icon={clock.playing ? 'pause' : 'play'} label={clock.playing ? 'Pause' : 'Play'} data-testid="replay-play" onClick={() => {
        if (clock.ended) clock.seek(0)
        clock.set({ playing: !clock.playing })
      }} />
      <IconButton icon="reset" label="Back to start" data-testid="replay-reset" onClick={() => clock.seek(0)} />
      <IconButton icon="stepBack" label="Back one physics frame" data-testid="replay-step-back" onClick={() => clock.stepFrame(-1)} />
      <IconButton icon="step" label="Forward one physics frame" data-testid="replay-step" onClick={() => clock.stepFrame(1)} />
      <input
        ref={scrubRef}
        className="replay-scrub"
        type="range"
        min={0}
        max={clock.duration || 1}
        step={clock.frameDt}
        defaultValue={0}
        aria-label="Replay position"
        data-testid="replay-scrub"
        onInput={(event) => {
          clock.playing = false
          clock.seek(Number(event.target.value))
        }}
        onPointerUp={(event) => event.target.blur()}
      />
      <span className="replay-time" ref={timeRef} data-testid="replay-time">0.00 s</span>
      <Select hideLabel label="Replay speed" value={String(clock.speed)} onChange={(value) => clock.set({ speed: Number(value) })} options={SPEEDS.map((value) => ({ value: String(value), label: `${value}×` }))} testId="replay-speed" />
      {showFollow ? (
        <Select hideLabel label="Camera" value={follow} onChange={onFollow} options={[{ value: 'champion', label: 'Follow' }, { value: 'fit', label: 'Fit all' }, { value: 'free', label: 'Free' }]} />
      ) : null}
      {extra}
    </div>
  )
}

export function useClockLoop(clock, scene) {
  // Replays outside the main arena drive their own clock from here.
  useEffect(() => {
    if (!scene) return undefined
    const duration = Math.max(...scene.tracks.map((track) => (track.recording.frameCount - 1) * track.recording.frameDt))
    clock.load(duration, { frameDt: scene.tracks[0].recording.frameDt })
    return undefined
  }, [clock, scene])
}
