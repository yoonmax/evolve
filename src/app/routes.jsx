import { lazy } from 'react'
import SimulatePage from '../pages/SimulatePage.jsx'

export const PAGES = {
  simulate: SimulatePage,
  create: lazy(() => import('../pages/CreatePage.jsx')),
  evolve: lazy(() => import('../pages/EvolvePage.jsx')),
  compete: lazy(() => import('../pages/CompetePage.jsx')),
  experiments: lazy(() => import('../pages/ExperimentsPage.jsx')),
  gallery: lazy(() => import('../pages/GalleryPage.jsx')),
  settings: lazy(() => import('../pages/SettingsPage.jsx')),
}
