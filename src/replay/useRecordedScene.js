// Re-simulates a list of genomes and packages the runs as a scene. Replays therefore
// never need stored frames, only the genome, environment and duration.
import { useEffect, useRef, useState } from 'react'
import { recordRun } from '../evolution/EvaluationManager.js'
import { makeTrack } from '../rendering/Track.js'
import { CancelledError, getPool } from '../workers/WorkerPool.js'

let groupCounter = 0

export function useRecordedScene(items, sceneOptions = {}, { detail = true } = {}) {
  const [state, setState] = useState({ scene: null, loading: false, error: null })
  const groupRef = useRef(`scene-${++groupCounter}`)
  const key = JSON.stringify(items?.map((item) => [item.key ?? item.genome, item.env, item.duration, item.spawnX, item.finishLine]) ?? null)

  useEffect(() => {
    if (!items || !items.length) {
      setState({ scene: null, loading: false, error: null })
      return undefined
    }
    let live = true
    setState((previous) => ({ ...previous, loading: true, error: null }))
    const pool = getPool()
    pool.cancelGroup(groupRef.current)
    Promise.all(
      items.map((item) => recordRun(item.genome, item.env, pool, {
        duration: item.duration ?? 12, detail, sim: item.sim, spawnX: item.spawnX ?? 0, finishLine: item.finishLine ?? null, group: groupRef.current,
      })),
    )
      .then((runs) => {
        if (!live) return
        const tracks = runs.map((run, i) => makeTrack(run, { label: items[i].label ?? items[i].genome.name, role: i === 0 ? 'champion' : 'ghost', original: items[i].original }))
        setState({ scene: { tracks, env: items[0].env, rulerOrigin: tracks[0].metrics.startX, heroIndex: 0, selected: 0, ...sceneOptions }, loading: false, error: null })
      })
      .catch((error) => {
        if (live && !(error instanceof CancelledError)) setState({ scene: null, loading: false, error: error.message })
      })
    return () => {
      live = false
    }
    // key captures everything about items that affects the simulation
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, sceneOptions.layout])

  return state
}
