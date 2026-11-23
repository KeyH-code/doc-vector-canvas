import { IText, StaticCanvas } from 'fabric'
import { connectionResolver, indexObjects, isConnector } from '../core/connections'
import type { ImageAsset } from '../core/imageAssets'
import type { CanvasObject } from '../core/scene'
import { applySceneObject, makeSceneObject } from '../editor/fabricObjects'

type Bounds = Readonly<{ left: number; top: number; width: number; height: number }>

export function selectionInPaintOrder(objects: readonly CanvasObject[], ids: readonly string[]) {
  const selected = new Set(ids)
  return objects.filter(object => selected.has(object.id))
}

export function selectionViewBox(bounds: readonly Bounds[]) {
  if (!bounds.length) return
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
  for (const box of bounds) {
    left = Math.min(left, box.left)
    top = Math.min(top, box.top)
    right = Math.max(right, box.left + box.width)
    bottom = Math.max(bottom, box.top + box.height)
  }
  const margin = 4
  const x = Math.floor(left) - margin, y = Math.floor(top) - margin
  const width = Math.ceil(right) + margin - x, height = Math.ceil(bottom) + margin - y
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return
  return { x, y, width, height }
}

function validXmlText(text: string) {
  // Project strings can contain control characters that cannot be represented in XML 1.0.
  return text.replace(/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, '\uFFFD')
}

export function textInkBounds(view: IText, context: CanvasRenderingContext2D): Bounds[] {
  // Measure the exact runs and baseline positions written by Fabric's SVG exporter.
  const markup = `<svg xmlns="http://www.w3.org/2000/svg">${view.toSVG()}</svg>`
  const text = new DOMParser().parseFromString(markup, 'image/svg+xml').querySelector('text')
  if (!text) return []
  const { fontSize, fontStyle, fontWeight } = view
  context.font = `${fontSize}px serif`
  context.font = `${fontStyle} ${fontWeight} ${fontSize}px ${text.getAttribute('font-family')}`
  context.textAlign = 'left'
  context.textBaseline = 'alphabetic'
  const [a, b, c, d, e, f] = view.calcTransformMatrix()
  return Array.from(text.querySelectorAll('tspan'), span => {
    const x = Number(span.getAttribute('x')), y = Number(span.getAttribute('y'))
    const ink = context.measureText(span.textContent ?? '')
    const xs = [x - ink.actualBoundingBoxLeft, x + ink.actualBoundingBoxRight]
    const ys = [y - ink.actualBoundingBoxAscent, y + ink.actualBoundingBoxDescent]
    const corners = xs.flatMap(px => ys.map(py => ({ x: a * px + c * py + e, y: b * px + d * py + f })))
    const left = Math.min(...corners.map(point => point.x)), top = Math.min(...corners.map(point => point.y))
    return { left, top, width: Math.max(...corners.map(point => point.x)) - left,
      height: Math.max(...corners.map(point => point.y)) - top }
  })
}

export function selectionSvg(objects: readonly CanvasObject[], ids: readonly string[], assets: readonly ImageAsset[] = []) {
  const selected = selectionInPaintOrder(objects, ids)
  if (!selected.length) return
  const element = document.createElement('canvas')
  const canvas = new StaticCanvas(element, { renderOnAddRemove: false, svgViewportTransformation: false })
  try {
    const context = canvas.getContext()
    // A selected connector still resolves against the full scene, including unselected hosts.
    const resolver = connectionResolver(indexObjects(objects))
    const images = new Map(assets.map(asset => [asset.id, asset]))
    const bounds = selected.flatMap(object => {
      const data = object.type === 'text' ? { ...object, text: validXmlText(object.text), fontFamily: validXmlText(object.fontFamily) }
        : isConnector(object) ? resolver.display(object) : object
      const view = makeSceneObject(data, images)
      applySceneObject(view, data)
      canvas.add(view)
      const box = view.getBoundingRect()
      return view instanceof IText ? [box, ...textInkBounds(view, context)] : [box]
    })
    const viewBox = selectionViewBox(bounds)
    if (!viewBox) throw new Error('选区大小无法表示为 SVG。')
    return canvas.toSVG({ suppressPreamble: true, viewBox, width: String(viewBox.width), height: String(viewBox.height) })
  } finally {
    void canvas.dispose()
  }
}
