import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/bricolage-grotesque/index.css'
import '@fontsource-variable/hanken-grotesk/index.css'
import '../styles/tokens.css'
import '../styles/app.css'
import App from './App.jsx'
import { useSim } from '../state/simulationStore.js'
import { useApp } from '../state/applicationStore.js'
import { useEditor } from '../state/editorStore.js'
import { getPool } from '../workers/WorkerPool.js'
import { recordRun } from '../evolution/EvaluationManager.js'
import { createPresets } from '../creatures/CreaturePresets.js'
import { EVOLVED_EXAMPLES } from '../creatures/evolvedExamples.js'
import { shareUrl } from '../export/GenomeExporter.js'

if (new URLSearchParams(location.search).has('debug')) {
  window.__evolve = { ...(window.__evolve ?? {}), useSim, useApp, useEditor, getPool, recordRun, createPresets, EVOLVED_EXAMPLES, shareUrl }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
