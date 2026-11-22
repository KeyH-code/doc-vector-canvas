import type { ScenePoint } from './geometry'

type PositionedObject = Readonly<{
  id: string
  x: number
  y: number
  rotation: number
}>

export type StrokeStyle = 'solid' | 'dashed'
type Outline = Readonly<{ stroke: string; strokeWidth: number; strokeStyle?: StrokeStyle }>

type BoxObject = PositionedObject & Outline & Readonly<{
  width: number
  height: number
  fill: string
}>

export type RectangleObject = BoxObject & Readonly<{ type: 'rectangle' }>
export type EllipseObject = BoxObject & Readonly<{ type: 'ellipse' }>
export type LineObject = PositionedObject & Outline & Readonly<{ type: 'line' | 'arrow'; dx: number; dy: number }>
export type StrokeObject = PositionedObject & Outline & Readonly<{ type: 'stroke'; points: readonly ScenePoint[] }>

export type TextObject = PositionedObject & Readonly<{
  type: 'text'
  text: string
  fontFamily: string
  fontSize: number
  color: string
}>

export type CanvasObject = RectangleObject | EllipseObject | LineObject | StrokeObject | TextObject
export type CanvasScene = Readonly<{ id: string; objects: readonly CanvasObject[] }>

const commonKeys = ['id', 'type', 'x', 'y', 'rotation']
const rectangleKeys = [...commonKeys, 'width', 'height', 'fill', 'stroke', 'strokeWidth']
const lineKeys = [...commonKeys, 'dx', 'dy', 'stroke', 'strokeWidth']
const strokeKeys = [...commonKeys, 'points', 'stroke', 'strokeWidth']
const textKeys = [...commonKeys, 'text', 'fontFamily', 'fontSize', 'color']

export function isDataRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

export function hasExactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(record).length === keys.length && keys.every((key) => Object.hasOwn(record, key))
}

export function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isPositive(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0
}

function isColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
}

function hasOutline(value: Record<string, unknown>) {
  return isColor(value.stroke) && isFiniteNumber(value.strokeWidth) && value.strokeWidth >= 0 &&
    (!Object.hasOwn(value, 'strokeStyle') || value.strokeStyle === 'solid' || value.strokeStyle === 'dashed')
}

function hasOutlineKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return hasExactKeys(value, Object.hasOwn(value, 'strokeStyle') ? [...keys, 'strokeStyle'] : keys)
}

function isScenePoint(value: unknown): value is ScenePoint {
  return isDataRecord(value) && hasExactKeys(value, ['x', 'y']) && isFiniteNumber(value.x) && isFiniteNumber(value.y)
}

function isStrokePath(value: unknown): value is readonly ScenePoint[] {
  if (!Array.isArray(value) || value.length < 2) return false
  const first: unknown = value[0]
  if (!isScenePoint(first)) return false
  let distinct = false
  for (const point of value) {
    if (!isScenePoint(point)) return false
    if (point.x !== first.x || point.y !== first.y) distinct = true
  }
  return distinct
}

export function isCanvasObject(value: unknown): value is CanvasObject {
  if (!isDataRecord(value) || !isNonBlankString(value.id) ||
      !isFiniteNumber(value.x) || !isFiniteNumber(value.y) || !isFiniteNumber(value.rotation)) return false

  if (value.type === 'rectangle' || value.type === 'ellipse') {
    return hasOutlineKeys(value, rectangleKeys) && isPositive(value.width) && isPositive(value.height) &&
      (value.fill === 'transparent' || isColor(value.fill)) && hasOutline(value)
  }
  if (value.type === 'line' || value.type === 'arrow') {
    return hasOutlineKeys(value, lineKeys) && hasOutline(value) && isFiniteNumber(value.dx) && isFiniteNumber(value.dy) &&
      (value.dx !== 0 || value.dy !== 0)
  }
  if (value.type === 'stroke') return hasOutlineKeys(value, strokeKeys) && hasOutline(value) && isStrokePath(value.points)
  return value.type === 'text' && hasExactKeys(value, textKeys) && typeof value.text === 'string' &&
    isNonBlankString(value.fontFamily) && isPositive(value.fontSize) && isColor(value.color)
}

function sameField(a: unknown, b: unknown) {
  if (a === b) return true
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
  return a.every((point: ScenePoint, index) => point.x === b[index].x && point.y === b[index].y)
}

export function createScene(id: string): CanvasScene {
  if (!isNonBlankString(id)) throw new TypeError('画布 ID 不能为空。')
  return { id, objects: [] }
}

export function sameScene(a: CanvasScene, b: CanvasScene): boolean {
  if (a === b) return true
  return a.id === b.id && a.objects.length === b.objects.length && a.objects.every((object, index) => {
    const other = b.objects[index]
    return object === other || (object.type === other.type &&
      Object.keys(object).length === Object.keys(other).length &&
      Object.entries(object).every(([key, value]) => sameField(value, other[key as keyof CanvasObject])))
  })
}
