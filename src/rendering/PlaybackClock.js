// The time cursor for replays: position, speed, loop. Several arenas can share one clock,
// which is how comparisons and races stay in step.
export class PlaybackClock {
  constructor({ duration = 0, speed = 1, loop = true, playing = true } = {}) {
    this.time = 0
    this.duration = duration
    this.speed = speed
    this.loop = loop
    this.playing = playing
    this.endCallbacks = new Set()
    this.listeners = new Set()
    this.lastTick = null
    this.ended = false
    this.frameDt = 1 / 60
  }

  subscribe(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  notify() {
    for (const listener of this.listeners) listener(this)
  }

  set(partial) {
    Object.assign(this, partial)
    this.notify()
  }

  load(duration, { keepTime = false, frameDt } = {}) {
    this.duration = duration
    if (frameDt) this.frameDt = frameDt
    if (!keepTime) this.time = 0
    this.ended = false
    this.notify()
  }

  seek(time) {
    this.time = Math.max(0, Math.min(this.duration, time))
    this.ended = this.time >= this.duration && !this.loop
    this.notify()
  }

  /** Moves one recorded physics frame. */
  stepFrame(direction = 1) {
    this.playing = false
    this.seek(Math.round(this.time / this.frameDt + direction) * this.frameDt)
  }

  /** Advances by real elapsed seconds. Real time only ever selects which state to show. */
  advance(realSeconds) {
    if (!this.playing || this.duration <= 0) return
    this.time += realSeconds * this.speed
    if (this.time >= this.duration) {
      for (const callback of [...this.endCallbacks]) callback()
      if (this.loop) {
        this.time %= this.duration
      } else {
        this.time = this.duration
        this.playing = false
        this.ended = true
      }
      this.notify()
    }
  }

  onEnd(callback) {
    this.endCallbacks.add(callback)
    return () => this.endCallbacks.delete(callback)
  }
}
