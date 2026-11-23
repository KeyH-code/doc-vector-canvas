import { PDFDocument, PDFName, degrees } from 'pdf-lib'
import { fromBase64 } from '../core/base64'
import type { DocumentCanvas, PdfSource } from '../core/document'
import type { PdfReader } from '../document/pdfImport'
import { pdfOverlayPlacement } from './documentExport'
import { maxOverlayBytes, overlay, overlaySize } from './pageOverlay'

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

export async function exportPdf(document: DocumentCanvas<PdfSource>, reader: PdfReader, indexes: readonly number[]) {
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
    const { width, height } = overlaySize(page)
    const png = await overlay(page, width, height, visiblePng)
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
