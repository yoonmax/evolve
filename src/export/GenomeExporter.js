// Files and links that leave the application. Everything coming back in goes through
// importGenome, which treats it as untrusted.
import { importGenome } from '../creatures/GenomeValidator.js'
import { genomeHash, SCHEMA_VERSION } from '../creatures/Genome.js'
import { PHYSICS_VERSION } from '../physics/constants.js'

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export function downloadText(text, filename, type = 'application/json') {
  downloadBlob(new Blob([text], { type }), filename)
}

const safeName = (name) => String(name ?? 'creature').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'creature'

export function creatureFile(genome, facts = {}) {
  return {
    kind: 'evolve/creature',
    schema: SCHEMA_VERSION,
    physicsVersion: PHYSICS_VERSION,
    exportedAt: new Date().toISOString(),
    facts,
    genome,
  }
}

export function exportCreature(genome, facts) {
  downloadText(JSON.stringify(creatureFile(genome, facts), null, 1), `evolve-${safeName(genome.name)}.json`)
}

/** What it takes to reproduce a replay: no frames, because frames can be re-simulated. */
export function replayMetadata(genome, env, duration, metrics) {
  return {
    kind: 'evolve/replay',
    physicsVersion: PHYSICS_VERSION,
    genomeHash: genomeHash(genome),
    env,
    duration,
    expected: metrics ? { distance: metrics.distance, stateHash: metrics.stateHash } : null,
    genome,
  }
}

export function exportReplayMetadata(genome, env, duration, metrics) {
  downloadText(JSON.stringify(replayMetadata(genome, env, duration, metrics), null, 1), `evolve-replay-${safeName(genome.name)}.json`)
}

export async function readGenomeFile(file) {
  if (file.size > 2_000_000) throw new Error('This file is too large to be a creature.')
  return importGenome(await file.text())
}

// Share links: the genome, compressed, in the URL fragment. Nothing is uploaded anywhere.
const MAX_LINK_CHARS = 24000

function toBase64Url(bytes) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text) {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

function requireCompression() {
  if (typeof CompressionStream === 'undefined') throw new Error('This browser cannot make share links. Export the creature as a file instead.')
}

async function pipeBytes(bytes, stream) {
  const piped = new Blob([bytes]).stream().pipeThrough(stream)
  return new Uint8Array(await new Response(piped).arrayBuffer())
}

export async function encodeShareToken(genome) {
  requireCompression()
  const { lineage: _lineage, tagline: _tagline, ...shared } = genome
  const json = JSON.stringify(shared, (_key, value) => (typeof value === 'number' ? Number(value.toFixed(5)) : value))
  const compressed = await pipeBytes(new TextEncoder().encode(json), new CompressionStream('deflate-raw'))
  const token = toBase64Url(compressed)
  if (token.length > MAX_LINK_CHARS) throw new Error('This creature is too large to share as a link. Export it as a file instead.')
  return token
}

export async function decodeShareToken(token) {
  if (!token || token.length > MAX_LINK_CHARS) throw new Error('This share link is too long to be valid.')
  requireCompression()
  let json
  try {
    const bytes = await pipeBytes(fromBase64Url(token), new DecompressionStream('deflate-raw'))
    if (bytes.length > 500_000) throw new Error('too large')
    json = new TextDecoder().decode(bytes)
  } catch {
    throw new Error('This share link is damaged.')
  }
  return importGenome(json)
}

export async function shareUrl(genome) {
  const token = await encodeShareToken(genome)
  return `${location.origin}${location.pathname}#/gallery?creature=${token}`
}
