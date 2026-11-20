type PositionedObject = Readonly<{
  id: string
  x: number
  y: number
  rotation: number
}>

export type RectangleObject = PositionedObject & Readonly<{
  type: 'rectangle'
  width: number
  height: number
  fill: string
  stroke: string
  strokeWidth: number
}>

export type TextObject = PositionedObject & Readonly<{
  type: 'text'
  text: string
  fontFamily: string
  fontSize: number
  color: string
}>

export type CanvasObject = RectangleObject | TextObject
export type CanvasScene = Readonly<{ id: string; objects: readonly CanvasObject[] }>

const commonKeys = ['id', 'type', 'x', 'y', 'rotation']
const rectangleKeys = [...commonKeys, 'width', 'height', 'fill', 'stroke', 'strokeWidth']
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

export function isCanvasObject(value: unknown): value is CanvasObject {
  if (!isDataRecord(value) || !isNonBlankString(value.id) ||
      !isFiniteNumber(value.x) || !isFiniteNumber(value.y) || !isFiniteNumber(value.rotation)) return false

  if (value.type === 'rectangle') {
    return hasExactKeys(value, rectangleKeys) && isPositive(value.width) && isPositive(value.height) &&
      (value.fill === 'transparent' || isColor(value.fill)) && isColor(value.stroke) &&
      isFiniteNumber(value.strokeWidth) && value.strokeWidth >= 0
  }
  return value.type === 'text' && hasExactKeys(value, textKeys) && typeof value.text === 'string' &&
    isNonBlankString(value.fontFamily) && isPositive(value.fontSize) && isColor(value.color)
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
      Object.entries(object).every(([key, value]) => other[key as keyof CanvasObject] === value))
  })
}
