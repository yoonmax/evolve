import { Suspense, useEffect } from 'react'
import { PAGES } from './routes.jsx'
import ErrorBoundary from '../components/ErrorBoundary.jsx'
import ToastHost from '../components/ToastHost.jsx'
import { IconButton } from '../components/ui.jsx'
import { ROUTES, resolveTheme, useApp } from '../state/applicationStore.js'
import { useSim } from '../state/simulationStore.js'
import { getPool } from '../workers/WorkerPool.js'

export default function App() {
  const route = useApp((state) => state.route)
  const theme = useApp((state) => state.theme)
  const session = useSim((state) => state.session)
  const app = useApp.getState()

  useEffect(() => {
    const onHash = () => useApp.getState().syncRoute()
    window.addEventListener('hashchange', onHash)
    app.applyTheme()
    app.loadPreferences().then(() => {
      const { workers } = useApp.getState().prefs
      if (workers) getPool().resize(workers)
    })
    const media = matchMedia('(prefers-color-scheme: dark)')
    const onScheme = () => {
      if (useApp.getState().theme === 'system') useApp.getState().applyTheme('system')
    }
    media.addEventListener('change', onScheme)
    return () => {
      window.removeEventListener('hashchange', onHash)
      media.removeEventListener('change', onScheme)
    }
    // app actions are stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    document.title = route === 'simulate' ? 'evolve' : `${route} / evolve`
  }, [route])

  const Page = PAGES[route]
  const isDark = resolveTheme(theme) === 'dark'
  return (
    <div className="shell">
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="topnav">
        <a className="wordmark" href="#/simulate" aria-label="evolve, home">evolve</a>
        <span className="topnav-experiment" data-testid="experiment-name">{session?.name ?? ''}</span>
        <nav className="topnav-links" aria-label="Sections">
          {ROUTES.filter((name) => name !== 'settings').map((name) => (
            <a key={name} href={`#/${name}`} aria-current={route === name ? 'page' : undefined}>{name}</a>
          ))}
        </nav>
        <div className="topnav-actions">
          <button type="button" className="btn btn-quiet" data-testid="save-experiment" onClick={() => useSim.getState().saveExperiment()}>Save</button>
          <a className="btn btn-quiet" href="#/settings" aria-current={route === 'settings' ? 'page' : undefined}>Settings</a>
          <IconButton icon={isDark ? 'sun' : 'moon'} label={isDark ? 'Use light theme' : 'Use dark theme'} onClick={() => useApp.getState().setTheme(isDark ? 'light' : 'dark')} />
        </div>
      </header>
      <main id="main" className="shell-main">
        <ErrorBoundary key={route}>
          <Suspense fallback={<div className="empty">Loading…</div>}>
            <Page />
          </Suspense>
        </ErrorBoundary>
      </main>
      <ToastHost />
    </div>
  )
}
