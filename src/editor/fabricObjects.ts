import { Ellipse, IText, Path, Point, Polygon, Polyline, Rect, type FabricObject } from 'fabric'
import { polygonVertices, strokePoints } from '../core/geometry'
import { pathTip, type LinePath } from '../core/linePaths'
import type { CanvasObject, TextObject } from '../core/scene'

export type Shape = Exclude<CanvasObject, TextObject>
export type ShapeView = Rect | Ellipse | Polyline | Path

export function makeShape(type: Shape['type'], path?: LinePath): ShapeView {
  if (type === 'rectangle' || type === 'square') return new Rect({ strokeUniform: true })
  if (type === 'ellipse') return new Ellipse({ strokeUniform: true })
  if (type === 'diamond' || type === 'star') return new Polygon([], { strokeUniform: true, strokeLineJoin: 'round', perPixelTargetFind: true })
  if (path) return new Path([], { fill: '', strokeLineCap: 'round', strokeLineJoin: 'round', perPixelTargetFind: true, padding: 7 })
  return new Polyline([], { fill: '', strokeLineCap: 'round', strokeLineJoin: 'round',
    perPixelTargetFind: true, padding: 7 })
}

export function pathOffset(object: Polyline | Path) {
  return new Point(object.pathOffset.x * object.scaleX, object.pathOffset.y * object.scaleY).rotate(object.angle * Math.PI / 180)
}

function vectorPath(path: LinePath, arrow: boolean) {
  const xy = ({ x, y }: { x: number; y: number }) => `${x} ${y}`
  const commands = [`M ${xy(path.start)}`]
  if (path.kind === 'polyline') commands.push(...path.segments.map(s => `L ${xy(s.to)}`))
  else commands.push(...path.segments.map(s => `C ${xy(s.c1)} ${xy(s.c2)} ${xy(s.to)}`))
  if (arrow) {
    const { tip, tangent } = pathTip(path)
    const length = Math.hypot(tangent.x, tangent.y)
    if (length) {
      const segment = path.segments.length > 1 ? path.segments.at(-2)!.to : path.start
      const head = Math.min(24, Math.max(length, Math.hypot(tip.x - segment.x, tip.y - segment.y)) / 3)
      const x = tangent.x / length, y = tangent.y / length, side = head * .48
      const wing = (sign: number) => xy({ x: tip.x - head * x + sign * side * y, y: tip.y - head * y - sign * side * x })
      commands.push(`M ${wing(1)} L ${xy(tip)} L ${wing(-1)}`)
    }
  }
  return commands.join(' ')
}

export function paintShape(object: ShapeView, shape: Shape) {
  const dash = Math.max(shape.strokeWidth, 1)
  object.set({ stroke: shape.stroke, strokeWidth: shape.strokeWidth, strokeDashArray: shape.strokeStyle === 'dashed' ? [dash * 3, dash * 2] : null })
  if (object instanceof Rect && (shape.type === 'rectangle' || shape.type === 'square')) {
    object.set({ width: shape.width, height: shape.height, fill: shape.fill })
  } else if (object instanceof Ellipse && shape.type === 'ellipse') {
    object.set({ rx: shape.width / 2, ry: shape.height / 2, fill: shape.fill })
  } else if (object instanceof Polygon && (shape.type === 'diamond' || shape.type === 'star')) {
    object.set({ points: polygonVertices(shape.type, shape.width, shape.height), fill: shape.fill, dirty: true })
    object.setBoundingBox()
  } else if (object instanceof Path && (shape.type === 'line' || shape.type === 'arrow') && shape.path) {
    object._setPath(vectorPath(shape.path, shape.type === 'arrow'))
    object.set('dirty', true)
    const offset = pathOffset(object)
    object.set({ left: shape.x + offset.x, top: shape.y + offset.y })
  } else if (object instanceof Polyline && (shape.type === 'stroke' || shape.type === 'line' || shape.type === 'arrow')) {
    object.set({ points: strokePoints(shape).map(({ x, y }) => ({ x, y })), dirty: true })
    object.setBoundingBox()
    const offset = pathOffset(object)
    object.set({ left: shape.x + offset.x, top: shape.y + offset.y })
  }
}

export function paintObject(object: FabricObject, data: CanvasObject) {
  if (object instanceof IText && data.type === 'text') {
    object.set({ text: data.text, fontFamily: data.fontFamily, fontSize: data.fontSize, fill: data.color })
  } else if ((object instanceof Rect || object instanceof Ellipse || object instanceof Polyline || object instanceof Path) && data.type !== 'text') {
    paintShape(object, data)
  }
  object.setCoords()
}

export function applySceneObject(object: FabricObject, data: CanvasObject) {
  object.set({ originX: 'center', originY: 'center', left: data.x, top: data.y, angle: data.rotation, scaleX: 1, scaleY: 1 })
  paintObject(object, data)
}

export function makeSceneObject(data: CanvasObject): FabricObject {
  return data.type === 'text' ? new IText(data.text) : makeShape(data.type, 'path' in data ? data.path : undefined)
}

export function measureTextAnchor(data: TextObject) {
  const view = new IText(data.text, { fontFamily: data.fontFamily, fontSize: data.fontSize })
  return { width: view.width, height: view.height }
}
