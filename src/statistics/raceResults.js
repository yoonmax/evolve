// Finishers come first, by time; everyone else by distance reached.
export function rankRacers(tracks) {
  return tracks
    .map((track, index) => ({ index, track, finish: track.metrics.finishTime, distance: track.metrics.distance }))
    .sort((a, b) => {
      if (a.finish !== null && b.finish !== null) return a.finish - b.finish
      if (a.finish !== null) return -1
      if (b.finish !== null) return 1
      return b.distance - a.distance
    })
}
