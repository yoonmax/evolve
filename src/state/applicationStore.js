import { create } from 'zustand'
import { loadKv, saveKv } from '../storage/ExperimentRepository.js'

export const ROUTES = ['simulate', 'create', 'evolve', 'compete', 'experiments', 'gallery', 'settings']

function routeFromHash() {
  const clean = location.hash.replace(/^#\/?/, '')
  const [name, query] = clean.split('?')
  return { route: ROUTES.includes(name) ? name : 'simulate', query: new URLSearchParams(query ?? '') }
}

function initialTheme() {
  try {
    const stored = localStorage.getItem('evolve:theme')
    if (stored === 'dark' || stored === 'light' || stored === 'system') return stored
  } catch {
    /* storage may be blocked; the default is fine */
  }
  return 'system'
}

export function resolveTheme(preference) {
  if (preference === 'system') return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  return preference
}

let toastId = 0

export const useApp = create((set, get) => ({
  ...routeFromHash(),
  theme: initialTheme(),
  advanced: false,
  toasts: [],
  announcement: '',
  themeTick: 0,
  prefs: { trails: true, reduceEffects: false, workers: null },

  syncRoute() {
    set(routeFromHash())
  },
  navigate(route, query) {
    const suffix = query ? `?${query}` : ''
    location.hash = `#/${route}${suffix}`
  },
  setTheme(theme) {
    try {
      localStorage.setItem('evolve:theme', theme)
    } catch {
      /* the choice still applies for this visit */
    }
    get().applyTheme(theme)
  },
  applyTheme(theme = get().theme) {
    document.documentElement.dataset.theme = resolveTheme(theme)
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', getComputedStyle(document.documentElement).getPropertyValue('--paper').trim())
    set((state) => ({ theme, themeTick: state.themeTick + 1 }))
  },
  setAdvanced(advanced) {
    set({ advanced })
    saveKv('advanced', advanced).catch(() => {})
  },
  setPref(key, value) {
    const prefs = { ...get().prefs, [key]: value }
    set({ prefs })
    saveKv('prefs', prefs).catch(() => {})
  },
  async loadPreferences() {
    const [advanced, prefs] = await Promise.all([loadKv('advanced', false), loadKv('prefs', null)])
    set((state) => ({ advanced: Boolean(advanced), prefs: prefs ? { ...state.prefs, ...prefs } : state.prefs }))
  },
  toast(message, { kind = 'info', ms = 3800 } = {}) {
    const id = ++toastId
    set((state) => ({ toasts: [...state.toasts.slice(-2), { id, message, kind }] }))
    setTimeout(() => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })), ms)
  },
  announce(announcement) {
    set({ announcement })
  },
}))

export const toast = (...args) => useApp.getState().toast(...args)
export const announce = (message) => useApp.getState().announce(message)
