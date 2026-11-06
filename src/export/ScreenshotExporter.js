import { downloadBlob } from './GenomeExporter.js'

/** Saves what the arena shows right now as a PNG. */
export function exportArenaScreenshot(root = document, name = 'evolve-arena.png') {
  const canvas = root.querySelector('[data-testid="arena-canvas"]')
  if (!canvas) return false
  canvas.toBlob((blob) => {
    if (blob) downloadBlob(blob, name)
  }, 'image/png')
  return true
}
