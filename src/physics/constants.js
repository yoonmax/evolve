// Physical units are SI throughout: metres, seconds, kilograms, newtons.
// benchmarks/timestep.mjs measured these settings: at 120 Hz with 8 velocity and
// 3 position iterations, p99 joint separation stays under 1 mm on a 15 N·m walker.
export const TIMESTEP = 1 / 120
export const CONTROL_EVERY = 2 // controllers run at 60 Hz, the solver at 120 Hz
export const VELOCITY_ITERATIONS = 8
export const POSITION_ITERATIONS = 3

export const SETTLE_SECONDS = 0.5 // motors hold the rest pose; fitness starts afterwards
export const SPAWN_CLEARANCE = 0.02

// Stability limits. Exceeding any of them marks the run invalid, which is a selection
// penalty rather than a crash: creatures cannot profit from breaking the solver.
export const MAX_BODY_SPEED = 30 // m/s
export const MAX_BODY_SPIN = 90 // rad/s
export const MAX_JOINT_ERROR = 0.25 // m of separation at a joint anchor
export const MAX_JOINT_ERROR_STEPS = 12 // tolerated consecutive control ticks
export const TUNNEL_MARGIN = 1.2 // m below the terrain surface

export const MAX_SEGMENTS = 16
export const PHYSICS_VERSION = 1
