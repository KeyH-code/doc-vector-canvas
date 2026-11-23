import { IText, StaticCanvas, type FabricObject } from 'fabric'
import { connectionResolver, indexObjects, isConnector } from '../core/connections'
import type { DocumentPage } from '../core/document'
import type { CanvasObject } from '../core/scene'
import type { PageReader } from '../document/pageReader'
import { applySceneObject, makeSceneObject } from '../editor/fabricObjects'
import { pageVisibility, type PageBounds, type PageSize } from './documentExport'
import { textInkBounds } from './selectionSvg'

export const maxOverlayBytes = 32 * 1024 * 1024
const maxOverlayPixels = 5_000_000
const maxOverlaySide = 4096

export function pageOverlay(page: DocumentPage) {
  const canvas = new StaticCanvas(document.createElement('canvas'), {
    enableRetinaScaling: false, renderOnAddRemove: false, skipOffscreen: false,
  })
  try {
    const resolver = connectionResolver(indexObjects(page.scene.objects))
    const images = new Map((page.scene.images ?? []).map(image => [image.id, image]))
    const objects = page.scene.objects.map(item => {
      const data = isConnector(item) ? resolver.display(item) : item
      const view = makeSceneObject(data, images)
      applySceneObject(view, data)
      return { data, view }
    })
    return { canvas, objects, images }
  } catch (error) { void canvas.dispose(); throw error }
}

export function paintedBounds(view: FabricObject, ctx: CanvasRenderingContext2D): PageBounds {
  const parts = [view.getBoundingRect(), ...(view instanceof IText ? textInkBounds(view, ctx) : [])]
  const left = Math.min(...parts.map(p => p.left)), top = Math.min(...parts.map(p => p.top))
  return { left, top, width: Math.max(...parts.map(p => p.left + p.width)) - left,
    height: Math.max(...parts.map(p => p.top + p.height)) - top }
}

export function overlayWarnings(page: DocumentPage, rasterized?: (object: CanvasObject, bounds: PageBounds, page: PageSize) => boolean) {
  const { canvas, objects } = pageOverlay(page)
  try {
    let outside = 0, partial = 0, raster = 0
    for (const { view, data } of objects) {
      const bounds = paintedBounds(view, canvas.getContext()), status = pageVisibility(page, bounds)
      if (status === 'outside') outside++
      if (status === 'partial') partial++
      if (rasterized && status !== 'outside' && (status === 'partial' || rasterized(data, bounds, page))) raster++
    }
    return { outside, partial, raster }
  } finally { void canvas.dispose() }
}

export function overlaySize(page: DocumentPage) {
  const scale = Math.min(3, maxOverlaySide / Math.max(page.width, page.height), Math.sqrt(maxOverlayPixels / (page.width * page.height)))
  return { width: Math.max(1, Math.floor(page.width * scale)), height: Math.max(1, Math.floor(page.height * scale)) }
}

export function setOverlayFrame(canvas: StaticCanvas, page: DocumentPage, width: number, height: number) {
  canvas.setDimensions({ width, height })
  canvas.setViewportTransform([width / page.width, 0, 0, height / page.height, 0, 0])
}

export function overlay<T>(page: DocumentPage, width: number, height: number, capture: (layer: HTMLCanvasElement) => T): T {
  const { canvas, objects } = pageOverlay(page)
  try {
    setOverlayFrame(canvas, page, width, height)
    canvas.add(...objects.map(({ view }) => view))
    canvas.renderAll()
    return capture(canvas.getElement())
  } finally { void canvas.dispose() }
}

export async function previewDocumentPage(reader: PageReader, page: DocumentPage, index: number, signal: AbortSignal) {
  const background = await reader.render(index, 430, signal)
  signal.throwIfAborted()
  overlay(page, background.width, background.height, layer => background.getContext('2d')!.drawImage(layer, 0, 0))
  return background.toDataURL('image/png')
}
