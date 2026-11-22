export type ScenePoint = Readonly<{ x: number; y: number }>
export const boxTypes = ['rectangle', 'ellipse', 'square', 'diamond', 'star'] as const
export type BoxType = (typeof boxTypes)[number]
export type SegmentType = 'line' | 'arrow'
export type DrawingType = BoxType | SegmentType | 'stroke'

type Box = { type: BoxType; x: number; y: number; width: number; height: number }
type Segment = { type: SegmentType; x: number; y: number; dx: number; dy: number }
type Stroke = { type: 'stroke'; x: number; y: number; points: readonly ScenePoint[] }

export function drawingGeometry(type: DrawingType, points: readonly ScenePoint[]): Box | Segment | Stroke | undefined {
  if (points.length < 2) return
  const start = points[0]
  const end = points[points.length - 1]

  if (type === 'stroke') {
    let left = start.x, right = start.x, top = start.y, bottom = start.y
    for (const { x, y } of points) {
      left = Math.min(left, x); right = Math.max(right, x)
      top = Math.min(top, y); bottom = Math.max(bottom, y)
    }
    if (left === right && top === bottom) return
    const x = (left + right) / 2, y = (top + bottom) / 2
    return { type, x, y, points: points.map(point => ({ x: point.x - x, y: point.y - y })) }
  }

  const x = (start.x + end.x) / 2, y = (start.y + end.y) / 2
  const dx = end.x - start.x, dy = end.y - start.y
  if (type === 'line' || type === 'arrow') return dx || dy ? { type, x, y, dx, dy } : undefined
  const width = Math.abs(dx), height = Math.abs(dy)
  if (type === 'square' && width && height) {
    const side = Math.min(width, height)
    return { type, x: start.x + Math.sign(dx) * side / 2, y: start.y + Math.sign(dy) * side / 2, width: side, height: side }
  }
  return width && height ? { type, x, y, width, height } : undefined
}

const diamond = [{ x: 0, y: -.5 }, { x: .5, y: 0 }, { x: 0, y: .5 }, { x: -.5, y: 0 }]
const rawStar = Array.from({ length: 10 }, (_, i) => {
  const angle = i * Math.PI / 5, radius = i % 2 ? .382 : 1
  return { x: radius * Math.sin(angle), y: -radius * Math.cos(angle) }
})
const starRight = rawStar[2].x, starBottom = rawStar[4].y
const star = rawStar.map(({ x, y }) => ({ x: x / (2 * starRight), y: (y + 1) / (starBottom + 1) - .5 }))

/** Clockwise from the top tip. The index is also the identity of the outgoing edge. */
export function polygonVertices(type: 'diamond' | 'star', width: number, height: number): ScenePoint[] {
  return (type === 'diamond' ? diamond : star).map(({ x, y }) => ({ x: x * width, y: y * height }))
}

export function strokePoints(data: Pick<Segment, 'type' | 'dx' | 'dy'> | Pick<Stroke, 'type' | 'points'>): readonly ScenePoint[] {
  if (data.type === 'stroke') return data.points
  const { dx, dy } = data
  const tip = { x: dx / 2, y: dy / 2 }
  const points = [{ x: 0 - tip.x, y: 0 - tip.y }, tip]
  if (data.type === 'arrow') {
    const length = Math.hypot(dx, dy)
    if (!length) return points
    const head = Math.min(24, length / 3)
    const x = dx / length, y = dy / length
    const side = head * .48
    points.push({ x: tip.x - head * x + side * y, y: tip.y - head * y - side * x }, tip,
      { x: tip.x - head * x - side * y, y: tip.y - head * y + side * x })
  }
  return points
}
