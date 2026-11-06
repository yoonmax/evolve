import { useEffect, useState } from 'react'
import { Segmented, Slider, Toggle } from '../components/ui.jsx'
import { useApp, toast } from '../state/applicationStore.js'
import { dbClear, storageUsage } from '../storage/Database.js'
import { getPool, suggestedWorkerCount } from '../workers/WorkerPool.js'
import { useSim } from '../state/simulationStore.js'

const bytes = (value) => (value < 1024 * 1024 ? `${(value / 1024).toFixed(0)} KB` : `${(value / 1024 / 1024).toFixed(1)} MB`)

export default function SettingsPage() {
  const theme = useApp((state) => state.theme)
  const advanced = useApp((state) => state.advanced)
  const prefs = useApp((state) => state.prefs)
  const app = useApp.getState()
  const session = useSim((state) => state.session)
  const version = useSim((state) => state.version)
  const [usage, setUsage] = useState(null)
  const suggested = suggestedWorkerCount()
  const workers = prefs.workers ?? suggested

  const refreshUsage = () => storageUsage().then(setUsage).catch(() => setUsage(null))
  useEffect(() => {
    refreshUsage()
  }, [])

  const clearAll = async () => {
    if (!window.confirm('Delete all saved creatures, experiments and preferences in this browser? This cannot be undone.')) return
    try {
      await dbClear()
      toast('All saved data deleted.')
      refreshUsage()
    } catch (error) {
      toast(error.message, { kind: 'error' })
    }
  }

  const history = session?.history ?? []
  void version
  const measured = session && session.evaluationMs > 0 ? (session.evaluations / session.evaluationMs) * 1000 : null

  return (
    <div className="page page-narrow" data-testid="settings-page">
      <h1 className="page-title">Settings</h1>
      <section className="section" aria-label="Appearance">
        <h2 className="section-title">Appearance</h2>
        <div className="row" style={{ marginTop: 8 }}>
          <Segmented label="Theme" value={theme} onChange={(value) => app.setTheme(value)} options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'system', label: 'Match system' }]} />
        </div>
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <Toggle label="Draw motion trails" checked={prefs.trails} onChange={(value) => app.setPref('trails', value)} />
          <Toggle label="Show all evolution settings" checked={advanced} onChange={(value) => app.setAdvanced(value)} />
        </div>
      </section>
      <section className="section" aria-label="Performance">
        <h2 className="section-title">Performance</h2>
        <p className="section-note">Simulations run in background workers, never on the page itself. Fewer workers use less CPU and battery; evolution just takes longer. This device suggests {suggested}.</p>
        <div style={{ maxWidth: 320 }}>
          <Slider label="Simulation workers" value={workers} min={1} max={Math.max(2, (navigator.hardwareConcurrency || 4))} step={1} format={String} onChange={(value) => {
            app.setPref('workers', value)
            getPool().resize(value)
          }} />
        </div>
        <p className="tag" style={{ marginTop: 8 }} data-testid="performance">
          {measured ? `Measured in this session: ${measured.toFixed(0)} creature evaluations per second across ${history.length} generations.` : 'Run an experiment to see measured speed on this device.'}
          {getPool().crashes ? ` ${getPool().crashes} worker restarts so far.` : ''}
        </p>
      </section>
      <section className="section" aria-label="Storage">
        <h2 className="section-title">Storage</h2>
        <p className="section-note">Everything is stored only in this browser, with no account or server. Experiments autosave every five generations.</p>
        <p data-testid="storage-usage">{usage ? `${bytes(usage.usage)} used of ${bytes(usage.quota)} available.` : 'Storage use is not available in this browser.'}</p>
        <button type="button" className="btn btn-danger" style={{ marginTop: 10 }} data-testid="clear-data" onClick={clearAll}>Delete all saved data</button>
      </section>
      <section className="section" aria-label="About">
        <h2 className="section-title">About the science</h2>
        <div className="page-lede">
          <p>evolve is artificial evolution, using a genetic algorithm and simulated articulated bodies. It does not model biological evolution in its full complexity.</p>
          <p style={{ marginTop: 8 }}>Fitness is defined by the score you choose. The physics is an approximation, built on the planck 2D rigid-body engine at a fixed 120 Hz. Outcomes are stochastic but reproducible from a seed, and improvement is not guaranteed in any generation. Populations can converge prematurely, and creatures can exploit their fitness function. Neural controllers here are small, simplified networks.</p>
        </div>
      </section>
    </div>
  )
}
