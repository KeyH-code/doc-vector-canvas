import { Ellipse, IText, Point, Polyline, Rect, type FabricObject } from 'fabric'
import { strokePoints } from '../core/geometry'
import type { CanvasObject, TextObject } from '../core/scene'

export type Shape = Exclude<CanvasObject, TextObject>
export type ShapeView = Rect | Ellipse | Polyline

export function makeShape(type: Shape['type']): ShapeView {
  if (type === 'rectangle') return new Rect({ strokeUniform: true })
  if (type === 'ellipse') return new Ellipse({ strokeUniform: true })
  return new Polyline([], { fill: '', strokeLineCap: 'round', strokeLineJoin: 'round',
    perPixelTargetFind: true, padding: 7 })
}

export function pathOffset(object: Polyline) {
  return new Point(object.pathOffset.x * object.scaleX, object.pathOffset.y * object.scaleY).rotate(object.angle * Math.PI / 180)
}

export function paintShape(object: ShapeView, shape: Shape) {
  const dash = Math.max(shape.strokeWidth, 1)
  object.set({ stroke: shape.stroke, strokeWidth: shape.strokeWidth, strokeDashArray: shape.strokeStyle === 'dashed' ? [dash * 3, dash * 2] : null })
  if (object instanceof Rect && shape.type === 'rectangle') {
    object.set({ width: shape.width, height: shape.height, fill: shape.fill })
  } else if (object instanceof Ellipse && shape.type === 'ellipse') {
    object.set({ rx: shape.width / 2, ry: shape.height / 2, fill: shape.fill })
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
  } else if ((object instanceof Rect || object instanceof Ellipse || object instanceof Polyline) && data.type !== 'text') {
    paintShape(object, data)
  }
  object.setCoords()
}

export function applySceneObject(object: FabricObject, data: CanvasObject) {
  object.set({ originX: 'center', originY: 'center', left: data.x, top: data.y, angle: data.rotation, scaleX: 1, scaleY: 1 })
  paintObject(object, data)
}

export function makeSceneObject(data: CanvasObject): FabricObject {
  return data.type === 'text' ? new IText(data.text) : makeShape(data.type)
}
