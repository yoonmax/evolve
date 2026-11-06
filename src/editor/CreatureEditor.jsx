import { useEffect, useState } from 'react'
import EditorCanvas from './EditorCanvas.jsx'
import MotorInspector from './MotorInspector.jsx'
import TestRunPanel from './TestRunPanel.jsx'
import { Select, Toggle } from '../components/ui.jsx'
import { Rng, randomSeed } from '../lib/rng.js'
import { useEditor } from '../state/editorStore.js'
import { useSim } from '../state/simulationStore.js'
import { toast, useApp } from '../state/applicationStore.js'
import { generateCreature } from '../creatures/CreatureGenerator.js'
import { createPresets } from '../creatures/CreaturePresets.js'
import { makeCreatureRecord, saveCreature } from '../storage/CreatureRepository.js'
import { exportCreature } from '../export/GenomeExporter.js'
import { duplicateSegment, removeSegment } from './SegmentTool.js'

export default function CreatureEditor() {
  const genome = useEditor((state) => state.genome)
  const selected = useEditor((state) => state.selected)
  const problems = useEditor((state) => state.problems)
  const past = useEditor((state) => state.past)
  const future = useEditor((state) => state.future)
  const tool = useEditor((state) => state.tool)
  const snap = useEditor((state) => state.snap)
  const grid = useEditor((state) => state.grid)
  const savedId = useEditor((state) => state.savedId)
  const editor = useEditor.getState()
  const [testing, setTesting] = useState(false)
  const [complexity, setComplexity] = useState('moderate')
  const invalid = problems.length > 0

  const remove = () => {
    if (!selected) return
    let removed = 0
    editor.update((draft) => { removed = removeSegment(draft, selected) })
    editor.select(0)
    if (removed > 1) toast(`Removed ${removed} segments. Undo brings them back.`)
  }

  const duplicate = () => {
    if (!selected) return
    let index = -1
    editor.update((draft) => { index = duplicateSegment(draft, selected) })
    if (index >= 0) editor.select(index)
    else toast('A creature can have at most 16 segments.', { kind: 'error' })
  }

  useEffect(() => {
    const keydown = (event) => {
      const target = event.target
      if (target.matches?.('input, select, textarea')) return
      const meta = event.metaKey || event.ctrlKey
      if (meta && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) useEditor.getState().redo()
        else useEditor.getState().undo()
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        const state = useEditor.getState()
        if (state.selected > 0) {
          state.update((draft) => { removeSegment(draft, state.selected) })
          state.select(0)
        }
      } else if (event.key === 'Escape') {
        useEditor.getState().setTool('select')
      } else if (event.key.startsWith('Arrow')) {
        const state = useEditor.getState()
        if (!state.selected) return
        event.preventDefault()
        const step = event.shiftKey ? 0.1 : 0.02
        state.update((draft) => {
          const anchor = draft.segments[state.selected].joint.anchorParent
          if (event.key === 'ArrowLeft') anchor.u = Math.max(-1, anchor.u - step)
          if (event.key === 'ArrowRight') anchor.u = Math.min(1, anchor.u + step)
          if (event.key === 'ArrowUp') anchor.v = Math.min(1, anchor.v + step)
          if (event.key === 'ArrowDown') anchor.v = Math.max(-1, anchor.v - step)
        }, { key: `nudge-${state.selected}` })
      }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [])

  const randomize = () => {
    const created = generateCreature(new Rng(randomSeed()), complexity)
    editor.load(created)
    setTesting(true)
  }

  const save = async () => {
    try {
      const record = makeCreatureRecord(genome, {})
      if (savedId) record.id = savedId
      await saveCreature(record)
      editor.setSavedId(record.id)
      toast(`Saved ${genome.name} to the gallery.`)
    } catch (error) {
      toast(error.message, { kind: 'error' })
    }
  }

  const evolveThis = () => {
    useSim.getState().useAncestor(genome, { start: true })
    useApp.getState().navigate('simulate')
  }

  return (
    <div className="editor">
      <div className="editor-stage">
        <div className="editor-toolbar" role="toolbar" aria-label="Creature tools">
          <button type="button" className={`btn ${tool === 'add' ? 'btn-primary' : ''}`} data-testid="add-limb" aria-pressed={tool === 'add'} title="Then click on the body where the limb should attach" onClick={() => editor.setTool(tool === 'add' ? 'select' : 'add')}>{tool === 'add' ? 'Click on the body…' : 'Add limb'}</button>
          <button type="button" className="btn btn-quiet" data-testid="duplicate" disabled={!selected} onClick={duplicate}>Duplicate</button>
          <button type="button" className="btn btn-quiet" data-testid="delete" disabled={!selected} onClick={remove}>Delete</button>
          <span className="control-sep" />
          <button type="button" className="btn btn-quiet" data-testid="undo" disabled={!past.length} onClick={() => editor.undo()}>Undo</button>
          <button type="button" className="btn btn-quiet" data-testid="redo" disabled={!future.length} onClick={() => editor.redo()}>Redo</button>
          <button type="button" className="btn btn-quiet" data-testid="editor-reset" onClick={() => editor.reset()}>Start over</button>
          <div className="bar-spacer" />
          <button type="button" className="btn" data-testid="test-run" disabled={invalid} onClick={() => setTesting(!testing)}>{testing ? 'Hide test' : 'Test'}</button>
          <button type="button" className="btn" data-testid="save-creature" disabled={invalid} onClick={save}>Save</button>
          <button type="button" className="btn btn-quiet" disabled={invalid} onClick={() => exportCreature(genome)}>Export</button>
          <button type="button" className="btn btn-primary" data-testid="evolve-this" disabled={invalid} onClick={evolveThis}>Start evolving this</button>
        </div>
        {invalid ? (
          <div className="problems" role="alert" data-testid="problems">
            {problems.slice(0, 3).map((problem) => <div key={problem.message}>{problem.message}</div>)}
          </div>
        ) : null}
        <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex' }}>
          <div className="editor-corner">
            <Toggle label="Snap" checked={snap} onChange={(value) => editor.setSnap(value)} />
            <Toggle label="Grid" checked={grid} onChange={(value) => editor.setGrid(value)} />
          </div>
          <EditorCanvas />
        </div>
        {testing && !invalid ? <TestRunPanel genome={genome} onClose={() => setTesting(false)} /> : null}
      </div>
      <aside className="editor-side" aria-label="Properties">
        <div className="inspector-group">
          <h3>Start from</h3>
          <Select hideLabel label="Start from a starter creature" value="" onChange={(value) => {
            const preset = createPresets().find((item) => item.name === value)
            if (preset) editor.load(preset)
          }} options={[{ value: '', label: 'Load a starter…' }, ...createPresets().map((item) => ({ value: item.name, label: item.name }))]} testId="editor-preset" />
          <div className="row">
            <Select hideLabel label="Random creature complexity" value={complexity} onChange={setComplexity} options={[{ value: 'simple', label: 'simple' }, { value: 'moderate', label: 'moderate' }, { value: 'complex', label: 'complex' }]} testId="complexity" />
            <button type="button" className="btn" data-testid="randomize" onClick={randomize}>Randomize</button>
          </div>
        </div>
        <div className="inspector-group">
          <h3>Segments</h3>
          <div className="seg-list" role="listbox" aria-label="Segments">
            {genome.segments.map((segment, index) => (
              <button key={segment.id} type="button" role="option" aria-selected={selected === index} className="seg-item" data-testid={`seg-${index}`} style={{ paddingLeft: 8 + depth(genome, index) * 12 }} onClick={() => editor.select(index)}>
                <i style={{ background: segment.color }} />
                {index === 0 ? 'body' : `segment ${index + 1}`}
              </button>
            ))}
          </div>
        </div>
        <MotorInspector />
      </aside>
    </div>
  )
}

function depth(genome, index) {
  let d = 0
  let cursor = genome.segments[index].parent
  while (cursor !== null && cursor !== undefined) {
    d++
    cursor = genome.segments[cursor].parent
  }
  return d
}
