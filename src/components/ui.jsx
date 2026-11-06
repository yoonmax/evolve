import { useId } from 'react'

export function Icon({ name }) {
  const paths = {
    play: <path d="M5 3.5v9l7.5-4.5z" fill="currentColor" />,
    pause: <path d="M4.5 3h2.6v10H4.5zM8.9 3h2.6v10H8.9z" fill="currentColor" />,
    reset: <path d="M3.5 8a4.5 4.5 0 1 0 1.5-3.4M3.2 2.6v2.9h2.9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />,
    step: <path d="M3.5 3.5v9l6-4.5zM10.6 3.2h2v9.6h-2z" fill="currentColor" />,
    stepBack: <path d="M12.5 3.5v9l-6-4.5zM5.4 3.2h-2v9.6h2z" fill="currentColor" />,
    chevron: <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />,
    moon: <path d="M13 9.4A5.4 5.4 0 1 1 6.6 3a4.3 4.3 0 0 0 6.4 6.4z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />,
    sun: <g fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><circle cx="8" cy="8" r="2.9" /><path d="M8 1.4v1.5M8 13.1v1.5M1.4 8h1.5M13.1 8h1.5M3.3 3.3l1 1M11.7 11.7l1 1M3.3 12.7l1-1M11.7 4.3l1-1" /></g>,
  }
  return <svg viewBox="0 0 16 16" aria-hidden="true">{paths[name]}</svg>
}

export function IconButton({ icon, label, className = '', ...props }) {
  return (
    <button type="button" className={`btn icon-btn btn-quiet ${className}`} aria-label={label} title={label} {...props}>
      <Icon name={icon} />
    </button>
  )
}

export function Slider({ label, value, min, max, step = 0.01, onChange, format, disabled, id }) {
  const generated = useId()
  const fieldId = id ?? generated
  return (
    <div className="slider-row">
      <label className="field-label" htmlFor={fieldId}>{label}</label>
      <output htmlFor={fieldId}>{format ? format(value) : value}</output>
      <input id={fieldId} type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))} />
    </div>
  )
}

export function Select({ label, value, onChange, options, disabled, hideLabel, testId }) {
  const id = useId()
  return (
    <div className="field">
      <label htmlFor={id} className={hideLabel ? 'visually-hidden' : undefined}>{label}</label>
      <select id={id} data-testid={testId} className="select" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </div>
  )
}

export function Toggle({ label, checked, onChange, disabled }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

export function Segmented({ label, value, onChange, options }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button key={option.value} type="button" aria-pressed={option.value === value} title={option.title} onClick={() => onChange(option.value)}>{option.label}</button>
      ))}
    </div>
  )
}

export function Readout({ value, unit, label, className = '', valueRef }) {
  return (
    <div className={`readout ${className}`}>
      <span className="readout-value"><span ref={valueRef}>{value}</span>{unit ? <span className="readout-unit">{unit}</span> : null}</span>
      <span className="readout-label">{label}</span>
    </div>
  )
}

export const fmt = {
  m: (value) => (value === null || value === undefined || !Number.isFinite(value) ? '–' : value.toFixed(2)),
  m1: (value) => (value === null || value === undefined || !Number.isFinite(value) ? '–' : value.toFixed(1)),
  pct: (value) => (value === null || value === undefined ? '–' : `${Math.round(value * 100)}%`),
}
