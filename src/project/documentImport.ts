import { maxDocumentBytes } from '../core/document'
import type { CanvasScene } from '../core/scene'
import { describePdf, fromBase64, openPdf, toBase64, validatePdfPages } from '../document/pdfImport'

export async function importPdf(file: File, signal?: AbortSignal) {
  if (file.size > maxDocumentBytes) throw new Error('PDF 文件不能超过 32 MiB。')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const reader = await openPdf(bytes, signal)
  const abort = () => { void reader.close().catch(() => undefined) }
  signal?.addEventListener('abort', abort, { once: true })
  try {
    const pages = await describePdf(reader, signal)
    const first = await reader.render(0, 1450, signal)
    const scene: CanvasScene = { id: crypto.randomUUID(), objects: [], document: { source: { kind: 'pdf', data: toBase64(bytes) }, pages } }
    return { scene, reader, first }
  } catch (error) {
    await reader.close().catch(() => undefined)
    throw error
  } finally {
    signal?.removeEventListener('abort', abort)
  }
}

export async function prepareDocument(scene: CanvasScene, signal?: AbortSignal) {
  if (!scene.document) return
  const reader = await openPdf(fromBase64(scene.document.source.data), signal)
  const abort = () => { void reader.close().catch(() => undefined) }
  signal?.addEventListener('abort', abort, { once: true })
  try {
    await validatePdfPages(reader, scene.document.pages, signal)
    return { reader, first: await reader.render(0, 1450, signal) }
  } catch (error) {
    await reader.close().catch(() => undefined)
    throw error
  } finally {
    signal?.removeEventListener('abort', abort)
  }
}
