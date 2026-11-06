import { useApp } from '../state/applicationStore.js'

export default function ToastHost() {
  const toasts = useApp((state) => state.toasts)
  const announcement = useApp((state) => state.announcement)
  return (
    <>
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((toast) => <div key={toast.id} className={`toast ${toast.kind === 'error' ? 'error' : ''}`}>{toast.message}</div>)}
      </div>
      <div className="visually-hidden" aria-live="polite" data-testid="announcer">{announcement}</div>
    </>
  )
}
