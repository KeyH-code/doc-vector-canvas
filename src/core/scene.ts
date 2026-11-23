import { boxTypes, type BoxType, type ScenePoint } from './geometry'
import { bindingKey, ends, type EndpointBinding } from './connections'
import { maxPathSegments, type LinePath } from './linePaths'
import type { ImageAsset } from './imageAssets'
import { sameDocument, type DocumentCanvas } from './document'

type PositionedObject = Readonly<{
  id: string
  x: number
  y: number
  rotation: number
}>

export type StrokeStyle = 'solid' | 'dashed'
type Outline = Readonly<{ stroke: string; strokeWidth: number; strokeStyle?: StrokeStyle }>

type BoxFields = PositionedObject & Outline & Readonly<{
  width: number
  height: number
  fill: string
}>

export type BoxObject = { [Type in BoxType]: BoxFields & Readonly<{ type: Type }> }[BoxType]
export type RectangleObject = Extract<BoxObject, { type: 'rectangle' }>
export type EllipseObject = Extract<BoxObject, { type: 'ellipse' }>
export type LineObject = PositionedObject & Outline & Readonly<{
  type: 'line' | 'arrow'; dx: number; dy: number; startBinding?: EndpointBinding; endBinding?: EndpointBinding; path?: LinePath
}>
export type StrokeObject = PositionedObject & Outline & Readonly<{ type: 'stroke'; points: readonly ScenePoint[] }>

export type TextObject = PositionedObject & Readonly<{
  type: 'text'
  text: string
  fontFamily: string
  fontSize: number
  color: string
  anchorSize?: Readonly<{ width: number; height: number }>
}>

export type ImageObject = PositionedObject & Readonly<{ type: 'image'; assetId: string; width: number; height: number }>
export type CanvasObject = BoxObject | LineObject | StrokeObject | TextObject | ImageObject
export type CanvasScene = Readonly<{ id: string; objects: readonly CanvasObject[]; images?: readonly ImageAsset[]; document?: DocumentCanvas }>

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

function isBinding(value: unknown): value is EndpointBinding {
  if (!isDataRecord(value) || !isNonBlankString(value.targetId)) return false
  if (value.kind === 'ellipse') return hasExactKeys(value, ['targetId', 'kind', 'angle']) && isFiniteNumber(value.angle)
  if (!isFiniteNumber(value.t) || value.t < 0 || value.t > 1) return false
  const index = value.kind === 'edge' ? 'edge' : value.kind === 'path' ? 'segment' : undefined
  return !!index && hasExactKeys(value, ['targetId', 'kind', index, 't']) && Number.isSafeInteger(value[index]) && (value[index] as number) >= 0
}

function isLinePath(value: unknown): value is LinePath {
  if (!isDataRecord(value) || !hasExactKeys(value, ['kind', 'start', 'segments']) ||
      (value.kind !== 'polyline' && value.kind !== 'curve') || !isScenePoint(value.start) ||
      !Array.isArray(value.segments) || !value.segments.length || value.segments.length > maxPathSegments) return false
  const cubic = value.kind === 'curve'
  return Array.from(value.segments).every((part: unknown, index: number) => isDataRecord(part) &&
    hasExactKeys(part, cubic ? ['id', 'to', 'c1', 'c2'] : ['id', 'to']) && part.id === index && isScenePoint(part.to) &&
    (!cubic || (isScenePoint(part.c1) && isScenePoint(part.c2))))
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

  if (boxTypes.some(type => type === value.type)) {
    return hasOutlineKeys(value, rectangleKeys) && isPositive(value.width) && isPositive(value.height) &&
      (value.type !== 'square' || value.width === value.height) &&
      (value.fill === 'transparent' || isColor(value.fill)) && hasOutline(value)
  }
  if (value.type === 'image') return hasExactKeys(value, [...commonKeys, 'assetId', 'width', 'height']) &&
    isNonBlankString(value.assetId) && isPositive(value.width) && isPositive(value.height)
  if (value.type === 'line' || value.type === 'arrow') {
    const present = ends.map(end => bindingKey[end]).filter(key => Object.hasOwn(value, key))
    const path = Object.hasOwn(value, 'path')
    return hasOutlineKeys(value, [...lineKeys, ...present, ...(path ? ['path'] : [])]) && hasOutline(value) &&
      isFiniteNumber(value.dx) && isFiniteNumber(value.dy) && present.every(key => isBinding(value[key])) && (!path || isLinePath(value.path))
  }
  if (value.type === 'stroke') return hasOutlineKeys(value, strokeKeys) && hasOutline(value) && isStrokePath(value.points)
  const measured = Object.hasOwn(value, 'anchorSize')
  return value.type === 'text' && hasExactKeys(value, measured ? [...textKeys, 'anchorSize'] : textKeys) && typeof value.text === 'string' &&
    (!measured || (isDataRecord(value.anchorSize) && hasExactKeys(value.anchorSize, ['width', 'height']) &&
      isPositive(value.anchorSize.width) && isPositive(value.anchorSize.height))) &&
    isNonBlankString(value.fontFamily) && isPositive(value.fontSize) && isColor(value.color)
}

function sameField(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (isDataRecord(a) && isDataRecord(b)) {
    return Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([key, value]) => Object.hasOwn(b, key) && sameField(value, b[key]))
  }
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
  return a.every((value, index) => sameField(value, b[index]))
}

export function createScene(id: string): CanvasScene {
  if (!isNonBlankString(id)) throw new TypeError('画布 ID 不能为空。')
  return { id, objects: [] }
}

export function sameScene(a: CanvasScene, b: CanvasScene): boolean {
  if (a === b) return true
  return a.id === b.id && sameDocument(a.document, b.document) && sameField(a.images ?? [], b.images ?? []) &&
    a.objects.length === b.objects.length && a.objects.every((object, index) => {
    const other = b.objects[index]
    return object === other || (object.type === other.type &&
      Object.keys(object).length === Object.keys(other).length &&
      Object.entries(object).every(([key, value]) => sameField(value, other[key as keyof CanvasObject])))
  })
}
