import type { ScenePoint } from '../core/geometry'

type ViewSize = Readonly<{ width: number; height: number }>
export type Viewport = Readonly<{ center: ScenePoint; zoom: number }>
export type WorldBounds = Readonly<{ left: number; top: number; width: number; height: number }>

const minZoom = .05
const maxZoom = 8
const centerLimit = 1e9
const limitZoom = (value: number) => Math.max(minZoom, Math.min(value, maxZoom))

function validCenter(point: ScenePoint) {
  return Number.isFinite(point.x) && Number.isFinite(point.y) && Math.abs(point.x) <= centerLimit && Math.abs(point.y) <= centerLimit
}

export function viewportMatrix(view: Viewport, size: ViewSize): [number, number, number, number, number, number] {
  const { center, zoom } = view
  return [zoom, 0, 0, zoom, size.width / 2 - center.x * zoom, size.height / 2 - center.y * zoom]
}

export function worldToView(view: Viewport, size: ViewSize, point: ScenePoint): ScenePoint {
  const [zoom, , , , x, y] = viewportMatrix(view, size)
  return { x: x + point.x * zoom, y: y + point.y * zoom }
}

export function viewToWorld(view: Viewport, size: ViewSize, point: ScenePoint): ScenePoint {
  const [zoom, , , , x, y] = viewportMatrix(view, size)
  return { x: (point.x - x) / zoom, y: (point.y - y) / zoom }
}

export function panViewport(view: Viewport, pixels: ScenePoint): Viewport {
  const center = { x: view.center.x - pixels.x / view.zoom, y: view.center.y - pixels.y / view.zoom }
  return validCenter(center) ? { center, zoom: view.zoom } : view
}

export function zoomViewport(view: Viewport, size: ViewSize, anchor: ScenePoint, factor: number): Viewport {
  if (!Number.isFinite(factor) || factor <= 0) return view
  const zoom = limitZoom(factor)
  if (zoom === view.zoom) return view
  const world = viewToWorld(view, size, anchor)
  const center = { x: world.x - (anchor.x - size.width / 2) / zoom, y: world.y - (anchor.y - size.height / 2) / zoom }
  return validCenter(center) ? { center, zoom } : view
}

export function fitViewport(size: ViewSize, box: WorldBounds): Viewport | undefined {
  const center = { x: box.left + box.width / 2, y: box.top + box.height / 2 }
  if (!validCenter(center) || !Number.isFinite(box.width) || !Number.isFinite(box.height)) return
  const zoom = limitZoom(Math.min(1, (size.width - 64) / Math.max(1, box.width), (size.height - 64) / Math.max(1, box.height)))
  return { center, zoom }
}

export function initialViewport(size: ViewSize): Viewport {
  // Keep legacy scenes around their original center, without using it as an editing boundary.
  const width = 1000, height = width * 450 / 760
  return { center: { x: width / 2, y: height / 2 }, zoom: limitZoom(Math.min(size.width / width, size.height / height)) }
}
