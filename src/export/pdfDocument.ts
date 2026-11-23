import { IText, StaticCanvas } from 'fabric'
import { PDFDocument, PDFName, degrees } from 'pdf-lib'
import { connectionResolver, indexObjects, isConnector } from '../core/connections'
import type { DocumentCanvas, DocumentPage } from '../core/document'
import { fromBase64, type PdfReader } from '../document/pdfImport'
import { applySceneObject, makeSceneObject } from '../editor/fabricObjects'
import { pageVisibility, pdfOverlayPlacement } from './documentExport'
import { textInkBounds } from './selectionSvg'

const maxOverlayPixels = 5_000_000
const maxOverlaySide = 4096
const maxOverlayBytes = 32 * 1024 * 1024

function withOverlayObjects<T>(page: DocumentPage, use: (canvas: StaticCanvas) => T): T {
  const canvas = new StaticCanvas(window.document.createElement('canvas'), {
    enableRetinaScaling: false, renderOnAddRemove: false, skipOffscreen: false,
  })
  try {
    const resolver = connectionResolver(indexObjects(page.scene.objects))
    const images = new Map((page.scene.images ?? []).map(image => [image.id, image]))
    for (const item of page.scene.objects) {
      const data = isConnector(item) ? resolver.display(item) : item
      const view = makeSceneObject(data, images)
      applySceneObject(view, data)
      canvas.add(view)
    }
    return use(canvas)
  } finally { void canvas.dispose() }
}

export function overlayWarnings(page: DocumentPage) {
  return withOverlayObjects(page, canvas => {
    let outside = 0, partial = 0
    for (const view of canvas.getObjects()) {
      const parts = [view.getBoundingRect(), ...(view instanceof IText ? textInkBounds(view, canvas.getContext()) : [])]
      const box = { left: Math.min(...parts.map(p => p.left)), top: Math.min(...parts.map(p => p.top)), width: 0, height: 0 }
      box.width = Math.max(...parts.map(p => p.left + p.width)) - box.left
      box.height = Math.max(...parts.map(p => p.top + p.height)) - box.top
      const status = pageVisibility(page, box)
      if (status === 'outside') outside++
      if (status === 'partial') partial++
    }
    return { outside, partial }
  })
}

function overlay<T>(page: DocumentPage, width: number, height: number, capture: (layer: HTMLCanvasElement) => T): T {
  return withOverlayObjects(page, canvas => {
    canvas.setDimensions({ width, height })
    canvas.setViewportTransform([width / page.width, 0, 0, height / page.height, 0, 0])
    canvas.renderAll()
    return capture(canvas.getElement())
  })
}

export async function previewPdfPage(reader: PdfReader, page: DocumentPage, index: number, signal: AbortSignal) {
  const background = await reader.render(index, 430, signal)
  signal.throwIfAborted()
  overlay(page, background.width, background.height, layer => background.getContext('2d')!.drawImage(layer, 0, 0))
  return background.toDataURL('image/png')
}

function visiblePng(layer: HTMLCanvasElement) {
  const { width, height } = layer, ctx = layer.getContext('2d')!
  // Small stripes prevent a second full-resolution RGBA allocation.
  for (let y = 0; y < height; y += 64) {
    const strip = ctx.getImageData(0, y, width, Math.min(64, height - y)).data
    for (let i = 3; i < strip.length; i += 4) if (strip[i]) {
      return new Promise<Blob>((resolve, reject) => layer.toBlob(blob => blob ? resolve(blob) : reject(new Error('PDF 编辑层无法编码。')), 'image/png'))
    }
  }
}

export async function exportPdf(document: DocumentCanvas, reader: PdfReader, indexes: readonly number[]) {
  if (!indexes.length || indexes.some(index => !Number.isSafeInteger(index) || !document.pages[index])) throw new Error('请选择有效页码。')
  const source = await PDFDocument.load(fromBase64(document.source.data), { updateMetadata: false })
  const output = await PDFDocument.create({ updateMetadata: false })
  for (const page of source.getPages()) {
    // Remove actions before copying. An internal link can otherwise pull in an unselected page.
    page.node.delete(PDFName.of('Annots'))
    page.node.delete(PDFName.of('AA'))
  }
  const pages = await output.copyPages(source, [...indexes])
  let bytes = 0
  for (const [i, writable] of pages.entries()) {
    const index = indexes[i], page = document.pages[index]
    output.addPage(writable)
    if (!page.scene.objects.length) continue
    const scale = Math.min(3, maxOverlaySide / Math.max(page.width, page.height), Math.sqrt(maxOverlayPixels / (page.width * page.height)))
    const png = await overlay(page, Math.max(1, Math.floor(page.width * scale)), Math.max(1, Math.floor(page.height * scale)), visiblePng)
    if (!png) continue
    bytes += png.size
    if (bytes > maxOverlayBytes) throw new Error('PDF 编辑层合计超过 32 MiB；请缩小导出范围。')
    const image = await output.embedPng(await png.arrayBuffer())
    const transform = (await reader.proxy.getPage(index + 1)).getViewport({ scale: 1 }).transform
    const { rotation, ...geometry } = pdfOverlayPlacement(transform, page)
    writable.drawImage(image, { ...geometry, rotate: degrees(rotation) })
    // Release its decoded channels now, rather than accumulating them until save().
    await image.embed()
  }
  return output.save()
}
