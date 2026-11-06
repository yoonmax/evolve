// Every control here writes a gene that reaches the simulation unchanged.
import { Select, Slider } from '../components/ui.jsx'
import { BOUNDS, HARMONICS, SHAPES } from '../creatures/Genome.js'
import { shapeArea, decodeGenome } from '../creatures/GenomeDecoder.js'
import { PIGMENTS } from '../creatures/CreaturePresets.js'
import { useEditor } from '../state/editorStore.js'
import { addSegment, descendantsOf, reparentSegment, setShape, sortTopologically } from './SegmentTool.js'

const deg = (radians) => `${Math.round((radians * 180) / Math.PI)}°`
const num2 = (value) => value.toFixed(2)

export default function MotorInspector() {
  const genome = useEditor((state) => state.genome)
  const selected = useEditor((state) => state.selected)
  const update = useEditor((state) => state.update)
  const select = useEditor((state) => state.select)
  const segment = genome.segments[selected]
  const totalMass = decodeGenome(genome).mass

  const setSegment = (field, key = field) => (value) => update((draft) => {
    const target = draft.segments[selected]
    target[field] = value
    if (field === 'w' && target.shape === 'circle') target.h = value
    if (field === 'w' && target.shape === 'capsule') target.h = Math.min(target.h, value)
  }, { key: `${selected}.${key}` })
  const setJoint = (field) => (value) => update((draft) => {
    draft.segments[selected].joint[field] = value
  }, { key: `${selected}.j.${field}` })
  const setAnchor = (which, axis) => (value) => update((draft) => {
    draft.segments[selected].joint[which][axis] = value
  }, { key: `${selected}.${which}.${axis}` })
  const setOsc = (field) => (value) => update((draft) => {
    draft.segments[selected].joint.osc[field] = value
  }, { key: `${selected}.o.${field}` })

  const parentOptions = segment?.joint
    ? genome.segments.map((candidate, index) => ({ candidate, index })).filter(({ index }) => index !== selected && !descendantsOf(genome, selected).has(index))
    : []

  return (
    <>
      <div className="inspector-group">
        <h3>Creature</h3>
        <div className="field">
          <label htmlFor="creature-name">Name</label>
          <input id="creature-name" className="input" data-testid="creature-name" value={genome.name} maxLength={60} onChange={(event) => update((draft) => { draft.name = event.target.value }, { key: 'name' })} />
        </div>
        <Slider label="Rhythm" value={genome.controller.frequency} min={BOUNDS.frequency[0]} max={BOUNDS.frequency[1]} onChange={(value) => update((draft) => { draft.controller.frequency = value }, { key: 'frequency' })} format={(value) => `${value.toFixed(2)} Hz`} />
        <p className="tag">{genome.segments.length} segments, {totalMass.toFixed(1)} kg in total</p>
      </div>

      {segment ? (
        <>
          <div className="inspector-group">
            <h3>{selected === 0 ? 'Body (root segment)' : `Segment ${selected + 1}`}</h3>
            <Select label="Shape" value={segment.shape} onChange={(value) => update((draft) => setShape(draft.segments[selected], value))} options={SHAPES.map((shape) => ({ value: shape, label: shape }))} testId="segment-shape" />
            <Slider label={segment.shape === 'circle' ? 'Diameter' : 'Length'} value={segment.w} min={BOUNDS.w[0]} max={segment.shape === 'circle' ? 0.9 : BOUNDS.w[1]} onChange={setSegment('w')} format={(value) => `${value.toFixed(2)} m`} />
            {segment.shape !== 'circle' ? <Slider label="Thickness" value={segment.h} min={BOUNDS.h[0]} max={segment.shape === 'capsule' ? Math.min(BOUNDS.h[1], segment.w) : BOUNDS.h[1]} onChange={setSegment('h')} format={(value) => `${value.toFixed(2)} m`} /> : null}
            {selected === 0 ? <Slider label="Rotation" value={genome.rootAngle} min={-3.1} max={3.1} onChange={(value) => update((draft) => { draft.rootAngle = value }, { key: 'rootAngle' })} format={deg} /> : null}
            <Slider label="Density" value={segment.density} min={BOUNDS.density[0]} max={BOUNDS.density[1]} step={0.5} onChange={setSegment('density')} format={(value) => `${value.toFixed(1)} kg/m² (${(value * shapeArea(segment)).toFixed(2)} kg)`} />
            <Slider label="Friction" value={segment.friction} min={BOUNDS.friction[0]} max={BOUNDS.friction[1]} onChange={setSegment('friction')} format={num2} />
            <Slider label="Bounciness" value={segment.restitution} min={BOUNDS.restitution[0]} max={BOUNDS.restitution[1]} onChange={setSegment('restitution')} format={num2} />
            <div className="field">
              <span className="field-label">Colour (does not affect physics)</span>
              <div className="swatches">
                {Object.entries(PIGMENTS).map(([name, color]) => (
                  <button key={name} type="button" className="swatch" style={{ background: color }} aria-label={name} aria-pressed={segment.color === color} onClick={() => update((draft) => { draft.segments[selected].color = color })} />
                ))}
              </div>
            </div>
            <button type="button" className="btn" data-testid="add-child" onClick={() => {
              let index = -1
              update((draft) => { index = addSegment(draft, selected, { u: 0.85, v: 0, rest: selected === 0 ? -Math.PI / 2 : 0.3 }) })
              if (index >= 0) select(index)
            }}>Attach a segment here</button>
          </div>

          {segment.joint ? (
            <>
              <div className="inspector-group">
                <h3>Joint</h3>
                <Select label="Connected to" value={String(segment.parent)} onChange={(value) => {
                  update((draft) => {
                    if (reparentSegment(draft, selected, Number(value))) sortTopologically(draft)
                  })
                  select(0)
                }} options={parentOptions.map(({ index }) => ({ value: String(index), label: index === 0 ? 'body' : `segment ${index + 1}` }))} testId="joint-parent" />
                <Slider label="Position on parent, along" value={segment.joint.anchorParent.u} min={-1} max={1} onChange={setAnchor('anchorParent', 'u')} format={num2} />
                <Slider label="Position on parent, across" value={segment.joint.anchorParent.v} min={-1} max={1} onChange={setAnchor('anchorParent', 'v')} format={num2} />
                <Slider label="Position on this segment" value={segment.joint.anchorChild.u} min={-1} max={1} onChange={setAnchor('anchorChild', 'u')} format={num2} />
                <Slider label="Rest angle" value={segment.joint.rest} min={BOUNDS.rest[0]} max={BOUNDS.rest[1]} onChange={setJoint('rest')} format={deg} />
                <Slider label="Limit, backward" value={segment.joint.lower} min={BOUNDS.lower[0]} max={BOUNDS.lower[1]} onChange={setJoint('lower')} format={deg} />
                <Slider label="Limit, forward" value={segment.joint.upper} min={BOUNDS.upper[0]} max={BOUNDS.upper[1]} onChange={setJoint('upper')} format={deg} />
              </div>
              <div className="inspector-group">
                <h3>Motor</h3>
                <Slider label="Strength" value={segment.joint.maxTorque} min={BOUNDS.maxTorque[0]} max={BOUNDS.maxTorque[1]} step={0.5} onChange={setJoint('maxTorque')} format={(value) => `${value.toFixed(1)} N·m`} />
                <Slider label="Top speed" value={segment.joint.maxSpeed} min={BOUNDS.maxSpeed[0]} max={BOUNDS.maxSpeed[1]} step={0.1} onChange={setJoint('maxSpeed')} format={(value) => `${value.toFixed(1)} rad/s`} />
                <Slider label="Responsiveness" value={segment.joint.gain} min={BOUNDS.gain[0]} max={BOUNDS.gain[1]} step={0.1} onChange={setJoint('gain')} format={(value) => value.toFixed(1)} />
                <Slider label="Damping" value={segment.joint.damping} min={BOUNDS.damping[0]} max={BOUNDS.damping[1]} onChange={setJoint('damping')} format={num2} />
              </div>
              <div className="inspector-group">
                <h3>Movement pattern</h3>
                {genome.controller.type === 'neural' ? <p className="tag">This creature uses a neural controller, so these oscillator settings are stored but not used.</p> : null}
                <Slider label="Swing" value={segment.joint.osc.amp} min={BOUNDS.amp[0]} max={BOUNDS.amp[1]} onChange={setOsc('amp')} format={deg} />
                <Slider label="Timing" value={segment.joint.osc.phase} min={BOUNDS.phase[0]} max={BOUNDS.phase[1]} onChange={setOsc('phase')} format={deg} />
                <Slider label="Centre angle" value={segment.joint.osc.offset} min={BOUNDS.offset[0]} max={BOUNDS.offset[1]} onChange={setOsc('offset')} format={deg} />
                <Select label="Rhythm multiple" value={String(segment.joint.osc.harmonic)} onChange={(value) => setOsc('harmonic')(Number(value))} options={HARMONICS.map((value) => ({ value: String(value), label: `${value}×` }))} />
                <Select label="Direction" value={String(segment.joint.osc.dir)} onChange={(value) => setOsc('dir')(Number(value))} options={[{ value: '1', label: 'normal' }, { value: '-1', label: 'reversed' }]} />
              </div>
            </>
          ) : null}
        </>
      ) : <p className="tag">Select a segment to edit it.</p>}
    </>
  )
}
