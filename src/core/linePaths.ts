import type { ScenePoint } from './geometry'

export type StraightPart = Readonly<{ id: number; to: ScenePoint }>
export type CubicPart = StraightPart & Readonly<{ c1: ScenePoint; c2: ScenePoint }>
export type PolylinePath = Readonly<{ kind: 'polyline'; start: ScenePoint; segments: readonly StraightPart[] }>
export type CurvePath = Readonly<{ kind: 'curve'; start: ScenePoint; segments: readonly CubicPart[] }>
export type LinePath = PolylinePath | CurvePath
export const maxPathSegments = 2048

export const add = (a: ScenePoint, b: ScenePoint): ScenePoint => ({ x: a.x + b.x, y: a.y + b.y })
export const subtract = (a: ScenePoint, b: ScenePoint): ScenePoint => ({ x: a.x - b.x, y: a.y - b.y })
export const distance = (a: ScenePoint, b: ScenePoint) => Math.hypot(a.x - b.x, a.y - b.y)
export const pathEnd = (path: LinePath) => path.segments.at(-1)!.to
export const interpolate = (a: ScenePoint, b: ScenePoint, t: number): ScenePoint => ({ x: a.x * (1 - t) + b.x * t, y: a.y * (1 - t) + b.y * t })

export function projectParameter(from: ScenePoint, to: ScenePoint, point: ScenePoint) {
  const dx = to.x - from.x, dy = to.y - from.y, size = Math.hypot(dx, dy)
  if (!size) return 0
  return Math.max(0, Math.min(1, ((point.x - from.x) * (dx / size) + (point.y - from.y) * (dy / size)) / size))
}

export function pointOnPart(from: ScenePoint, part: StraightPart | CubicPart, t: number) {
  if (!('c1' in part)) return interpolate(from, part.to, t)
  const a = interpolate(from, part.c1, t), b = interpolate(part.c1, part.c2, t), c = interpolate(part.c2, part.to, t)
  return interpolate(interpolate(a, b, t), interpolate(b, c, t), t)
}

export function makePolyline(start: ScenePoint, to: ScenePoint): PolylinePath | undefined {
  if (!distance(start, to)) return
  return { kind: 'polyline', start, segments: [{ id: 0, to }] }
}

export function appendSegment(path: PolylinePath, to: ScenePoint): PolylinePath | undefined {
  if (path.segments.length >= maxPathSegments || !distance(pathEnd(path), to)) return
  return { ...path, segments: [...path.segments, { id: path.segments.at(-1)!.id + 1, to }] }
}

export function pathTip(path: LinePath) {
  const tip = pathEnd(path)
  for (let i = path.segments.length - 1; i >= 0; i--) {
    const part = path.segments[i]
    const from = i ? path.segments[i - 1].to : path.start
    const candidates = path.kind === 'curve' ? [path.segments[i].c2, path.segments[i].c1, from] : [from]
    for (const point of candidates) if (distance(tip, point)) return { tip, tangent: subtract(tip, point) }
  }
  return { tip, tangent: { x: 0, y: 0 } }
}

/** The same local arrowhead points are used for drawing and structural bounds. */
export function pathArrowhead(path: LinePath): readonly ScenePoint[] {
  const { tip, tangent } = pathTip(path)
  const length = Math.hypot(tangent.x, tangent.y)
  if (!length) return []
  const lastStart = path.segments.length > 1 ? path.segments.at(-2)!.to : path.start
  const head = Math.min(24, Math.max(length, distance(tip, lastStart)) / 3)
  const x = tangent.x / length, y = tangent.y / length, side = head * .48
  const wing = (sign: number) => ({ x: tip.x - head * x + sign * side * y, y: tip.y - head * y - sign * side * x })
  return [wing(1), tip, wing(-1)]
}

export function mapLinePath(path: LinePath, transform: (point: ScenePoint) => ScenePoint): LinePath {
  const start = transform(path.start)
  return path.kind === 'polyline'
    ? { ...path, start, segments: path.segments.map(s => ({ ...s, to: transform(s.to) })) }
    : { ...path, start, segments: path.segments.map(s => ({ ...s, to: transform(s.to), c1: transform(s.c1), c2: transform(s.c2) })) }
}

export function movePathEnds(path: LinePath, start: ScenePoint, end: ScenePoint): LinePath {
  const last = path.segments.length - 1
  if (path.kind === 'polyline') return { ...path, start, segments: path.segments.map((s, i) => i === last ? { ...s, to: end } : s) }
  const headDelta = subtract(start, path.start), tailDelta = subtract(end, pathEnd(path))
  return { ...path, start, segments: path.segments.map((s, i) => ({ ...s,
    c1: i === 0 ? add(s.c1, headDelta) : s.c1,
    c2: i === last ? add(s.c2, tailDelta) : s.c2,
    to: i === last ? end : s.to })) }
}

export function pathLength(path: LinePath) {
  let total = 0, previous = path.start
  for (const part of path.segments) {
    if (path.kind === 'curve') {
      let last = previous
      for (let j = 1; j <= 16; j++) {
        const next = pointOnPart(previous, part, j / 16)
        total += distance(last, next)
        last = next
      }
    } else total += distance(previous, part.to)
    previous = part.to
  }
  return total
}

/** When a release overshoots an anchor, trim the terminal samples instead of drawing back to it. */
export function snappedCurveSamples(samples: readonly ScenePoint[], pointer: ScenePoint, anchor: ScenePoint) {
  const gap = distance(pointer, anchor)
  let behind = samples.length - 1
  while (behind > 0 && distance(samples[behind], pointer) <= gap) behind--
  const direction = subtract(pointer, samples[behind])
  const afterAnchor = (point: ScenePoint) => (point.x - anchor.x) * direction.x + (point.y - anchor.y) * direction.y
  let end = samples.length
  if (gap && afterAnchor(pointer) > 0) {
    while (end > 1 && afterAnchor(samples[end - 1]) >= 0) end--
  }
  return [...samples.slice(0, end), anchor]
}

/** Drop small deviations, then interpolate with shared, locally bounded tangents. */
export function fitCurve(input: readonly ScenePoint[], tolerance: number): CurvePath | undefined {
  if (!Number.isFinite(tolerance) || tolerance <= 0) return
  const points: ScenePoint[] = []
  for (const point of input) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return
    if (!points.length || distance(point, points.at(-1)!) > 0) points.push(point)
  }
  if (points.length < 2 || points.length > maxPathSegments + 1) return
  const keep = new Set([0, points.length - 1]), pending = [[0, points.length - 1]]
  while (pending.length) {
    const [lo, hi] = pending.pop()!
    const from = points[lo], to = points[hi]
    let farthest = tolerance, split = -1
    for (let i = lo + 1; i < hi; i++) {
      const point = points[i]
      const gap = distance(point, interpolate(from, to, projectParameter(from, to, point)))
      if (gap > farthest) { farthest = gap; split = i }
    }
    if (split !== -1) { keep.add(split); pending.push([lo, split], [split, hi]) }
  }
  const knots = points.filter((_, i) => keep.has(i))
  const tangents = knots.map((point, i) => {
    const a = subtract(point, knots[i - 1] ?? point), b = subtract(knots[i + 1] ?? point, point)
    const axis = (before: number, after: number) => {
      if (i === 0) return after / 3
      if (i === knots.length - 1) return before / 3
      return Math.sign(before) === Math.sign(after) ? Math.sign(before) * Math.min(Math.abs(before), Math.abs(after)) / 3 : 0
    }
    return { x: axis(a.x, b.x), y: axis(a.y, b.y) }
  })
  if (knots.length === 2 && !distance(knots[0], knots[1])) return
  return { kind: 'curve', start: knots[0], segments: knots.slice(1).map((to, id) => ({
    id, to, c1: add(knots[id], tangents[id]), c2: subtract(to, tangents[id + 1]),
  })) }
}
