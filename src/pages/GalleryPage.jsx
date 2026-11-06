// The creature library: saved organisms, evolved examples and the starters.
import { useCallback, useEffect, useRef, useState } from 'react'
import Thumb from '../components/Thumb.jsx'
import { createPresets } from '../creatures/CreaturePresets.js'
import { EVOLVED_EXAMPLES } from '../creatures/evolvedExamples.js'
import { deleteCreature, listCreatures, makeCreatureRecord, saveCreature } from '../storage/CreatureRepository.js'
import { decodeShareToken, exportCreature, readGenomeFile, shareUrl } from '../export/GenomeExporter.js'
import { getEnvironment } from '../physics/Environments.js'
import { useSim } from '../state/simulationStore.js'
import { useEditor } from '../state/editorStore.js'
import { toast, useApp } from '../state/applicationStore.js'

export default function GalleryPage() {
  const [items, setItems] = useState([])
  const [corrupt, setCorrupt] = useState(0)
  const [unavailable, setUnavailable] = useState(null)
  const [shared, setShared] = useState(null)
  const fileRef = useRef(null)
  const query = useApp((state) => state.query)

  const refresh = useCallback(async () => {
    try {
      const { creatures, corrupt: bad } = await listCreatures()
      setItems(creatures)
      setCorrupt(bad)
    } catch (error) {
      setUnavailable(error.message)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    const token = query.get('creature')
    if (!token) return
    decodeShareToken(token).then(setShared).catch((error) => toast(error.message, { kind: 'error' }))
  }, [query])

  const importFile = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const genome = await readGenomeFile(file)
      await saveCreature(makeCreatureRecord(genome, {}))
      toast(`Imported ${genome.name}.`)
      refresh()
    } catch (error) {
      toast(`Could not import that file. ${error.message}`, { kind: 'error', ms: 7000 })
    }
  }

  const saveShared = async () => {
    try {
      await saveCreature(makeCreatureRecord(shared, {}))
      setShared(null)
      useApp.getState().navigate('gallery')
      refresh()
      toast(`Saved ${shared.name}.`)
    } catch (error) {
      toast(error.message, { kind: 'error' })
    }
  }

  return (
    <div className="page" data-testid="gallery-page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Gallery</h1>
          <p className="page-lede">Saved creatures live in this browser. Every portrait is drawn from the creature&apos;s actual body.</p>
        </div>
        <div className="row">
          <input ref={fileRef} type="file" accept="application/json,.json" hidden data-testid="import-file" onChange={importFile} />
          <button type="button" className="btn" data-testid="import-button" onClick={() => fileRef.current.click()}>Import a genome</button>
          <a className="btn btn-primary" href="#/create">Build a creature</a>
        </div>
      </div>
      {corrupt ? <p className="error-text">{corrupt} saved creatures were damaged and could not be loaded.</p> : null}
      {unavailable ? <p className="error-text">{unavailable}</p> : null}

      {shared ? (
        <section className="section" aria-label="Shared creature" data-testid="shared-creature">
          <h2 className="section-title">Someone shared this creature</h2>
          <p className="section-note">It will be simulated here from scratch; nothing was uploaded to or downloaded from a server.</p>
          <div className="gallery-grid">
            <Specimen genome={shared} name={shared.name} facts={{ controller: shared.controller.type }} actions={[{ label: 'Save', primary: true, run: saveShared }, ...commonActions(shared)]} />
          </div>
        </section>
      ) : null}

      <section className="section" aria-labelledby="saved-heading">
        <h2 className="section-title" id="saved-heading">Saved</h2>
        {items.length ? (
          <div className="gallery-grid" data-testid="saved-grid">
            {items.map((item) => (
              <Specimen
                key={item.id}
                genome={item.genome}
                name={item.name}
                onRename={async (name) => {
                  await saveCreature({ ...item, name, genome: { ...item.genome, name } })
                  refresh()
                }}
                facts={{ generation: item.generation, fitness: item.fitness, distance: item.distance, controller: item.controller, environment: item.envId }}
                actions={[
                  ...commonActions(item.genome, item.id, `saved:${item.id}`),
                  { label: 'Duplicate', run: async () => { await saveCreature(makeCreatureRecord({ ...item.genome, name: `${item.name} copy` }, item)); refresh() } },
                  { label: 'Delete', run: async () => { if (window.confirm(`Delete ${item.name}? This cannot be undone.`)) { await deleteCreature(item.id); refresh() } } },
                ]}
              />
            ))}
          </div>
        ) : <p className="tag">Nothing saved yet. Save a creature from an experiment or from the editor, and it will appear here.</p>}
      </section>

      <section className="section" aria-labelledby="examples-heading">
        <h2 className="section-title" id="examples-heading">Evolved examples</h2>
        <p className="section-note">Real results from this genetic algorithm, run for 90 generations with 40 creatures. Race them or keep evolving them; every run is simulated from scratch in your browser.</p>
        <div className="gallery-grid" data-testid="examples-grid">
          {EVOLVED_EXAMPLES.map((genome) => (
            <Specimen key={genome.name} genome={genome} name={genome.name} facts={{ generation: genome.lineage?.generation, distance: genome.lineage?.distance, controller: genome.controller.type, environment: genome.lineage?.env }} note={genome.tagline} actions={commonActions(genome, undefined, `example:${genome.name}`)} />
          ))}
        </div>
      </section>

      <section className="section" aria-labelledby="starters-heading">
        <h2 className="section-title" id="starters-heading">Starters</h2>
        <p className="section-note">Bodies with naive controllers. They are meant to be bad at this.</p>
        <div className="gallery-grid">
          {createPresets().map((genome) => (
            <Specimen key={genome.name} genome={genome} name={genome.name} facts={{ controller: genome.controller.type }} note={genome.tagline} actions={commonActions(genome, undefined, `preset:${genome.name}`)} />
          ))}
        </div>
      </section>
    </div>
  )
}

function commonActions(genome, savedId, racerId) {
  return [
    { label: 'Start evolving', run: () => { useSim.getState().useAncestor(genome, { start: true }); useApp.getState().navigate('simulate') } },
    { label: 'Edit', run: () => { useEditor.getState().load(genome, { savedId }); useApp.getState().navigate('create') } },
    ...(racerId ? [{ label: 'Race', run: () => useApp.getState().navigate('compete', `racer=${encodeURIComponent(racerId)}`) }] : []),
    { label: 'Export', run: () => exportCreature(genome) },
    { label: 'Copy link', run: async () => {
      try {
        const url = await shareUrl(genome)
        await navigator.clipboard.writeText(url)
        toast('Link copied. The creature travels inside the link itself.')
      } catch (error) {
        toast(error.message, { kind: 'error' })
      }
    } },
  ]
}

function Specimen({ genome, name, facts, actions, onRename, note }) {
  const [draft, setDraft] = useState(name)
  useEffect(() => setDraft(name), [name])
  const rows = [
    facts.generation !== null && facts.generation !== undefined ? ['Generation', facts.generation] : null,
    facts.distance !== null && facts.distance !== undefined ? ['Distance', `${facts.distance.toFixed(2)} m`] : null,
    facts.fitness !== null && facts.fitness !== undefined ? ['Fitness', facts.fitness.toFixed(2)] : null,
    ['Controller', facts.controller === 'neural' ? 'neural network' : 'oscillators'],
    facts.environment ? ['Environment', getEnvironment(facts.environment).name] : null,
  ].filter(Boolean)
  return (
    <article className="specimen" data-testid="specimen">
      <Thumb genome={genome} label={`${name}, ${genome.segments.length} body segments`} />
      {onRename ? (
        <input className="specimen-name" aria-label="Creature name" data-testid="specimen-name" value={draft} maxLength={60} onChange={(event) => setDraft(event.target.value)} onBlur={() => { if (draft && draft !== name) onRename(draft) }} onKeyDown={(event) => { if (event.key === 'Enter') event.target.blur() }} />
      ) : <div className="specimen-name">{name}</div>}
      {note ? <p className="tag">{note}</p> : null}
      <dl className="specimen-facts">
        {rows.map(([label, value]) => <div key={label} style={{ display: 'contents' }}><dt>{label}</dt><dd>{value}</dd></div>)}
      </dl>
      <div className="specimen-actions">
        {actions.map((action) => <button key={action.label} type="button" className={`btn ${action.primary ? 'btn-primary' : 'btn-quiet'}`} onClick={action.run}>{action.label}</button>)}
      </div>
    </article>
  )
}
