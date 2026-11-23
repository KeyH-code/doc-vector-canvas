import { AnnotationMode, getDocument, PDFWorker, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist'
import assets, { workerSource } from 'virtual:bundled-pdf-assets'
import { fromBase64 } from '../core/base64'
import { acceptablePageSize, maxDocumentBytes, maxDocumentPages, maxSourceText, type DocumentPage } from '../core/document'
import type { PageReader } from './pageReader'

class BundledBinaryDataFactory {
  async fetch({ kind, filename }: { kind: string; filename: string }) {
    const key = `${kind}/${filename}`
    if (!Object.hasOwn(assets, key)) throw new Error('PDF 内置资源不可用。')
    return fromBase64(assets[key])
  }
}

export type PdfReader = PageReader & { proxy: PDFDocumentProxy }

export async function openPdf(bytes: Uint8Array, signal?: AbortSignal): Promise<PdfReader> {
  if (!bytes.length || bytes.length > maxDocumentBytes) throw new Error('PDF 文件不能超过 32 MiB。')
  if (!new TextDecoder().decode(bytes.subarray(0, 8)).startsWith('%PDF-')) throw new Error('所选文件不是受支持的 PDF。')
  signal?.throwIfAborted()
  const workerUrl = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }))
  const port = new Worker(workerUrl, { type: 'module' })
  // Runtime accepts an existing Worker; the library's generated type only declares the null default.
  const worker = new PDFWorker({ port } as unknown as ConstructorParameters<typeof PDFWorker>[0])
  const task = getDocument({ data: bytes.slice(), worker, isEvalSupported: false, useWorkerFetch: false,
    cMapUrl: 'local-cmaps/', standardFontDataUrl: 'local-fonts/', wasmUrl: 'local-wasm/', cMapPacked: true,
    BinaryDataFactory: BundledBinaryDataFactory, enableXfa: false, stopAtErrors: true, maxImageSize: 48_000_000,
    canvasMaxAreaInBytes: 48 * 1024 * 1024 } as Parameters<typeof getDocument>[0])
  let closed: Promise<void> | undefined
  const close = () => closed ??= (async () => {
    try { await task.destroy() } finally { worker.destroy(); port.terminate(); URL.revokeObjectURL(workerUrl) }
  })()
  let password = false
  task.onPassword = () => { password = true; void close().catch(() => undefined) }
  const abort = () => { void close().catch(() => undefined) }
  signal?.addEventListener('abort', abort, { once: true })
  let proxy: PDFDocumentProxy
  try {
    proxy = await task.promise
    if (proxy.numPages < 1 || proxy.numPages > maxDocumentPages) throw new Error(`PDF 页数须在 1～${maxDocumentPages} 页之间。`)
    const { info } = await proxy.getMetadata()
    if (info && 'EncryptFilterName' in info && info.EncryptFilterName) { password = true; throw new Error('PDF 已加密。') }
  } catch (error) {
    await close().catch(() => undefined)
    if (password) throw new Error('暂不支持加密或需要密码的 PDF。')
    if (signal?.aborted) signal.throwIfAborted()
    if (error instanceof Error && error.message.startsWith('PDF 页数')) throw error
    throw new Error('无法解析 PDF，文件可能损坏或使用了不支持的特性。')
  } finally {
    signal?.removeEventListener('abort', abort)
  }
  async function render(index: number, longSide: number, signal?: AbortSignal) {
    signal?.throwIfAborted()
    const page = await proxy.getPage(index + 1)
    signal?.throwIfAborted()
    const normal = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: Math.min(3, longSide / Math.max(normal.width, normal.height)) })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height)
    const job: RenderTask = page.render({ canvas, viewport, annotationMode: AnnotationMode.DISABLE })
    const cancel = () => job.cancel()
    signal?.addEventListener('abort', cancel, { once: true })
    try { await job.promise; return canvas }
    finally { signal?.removeEventListener('abort', cancel); page.cleanup() }
  }
  return { proxy, close, render }
}

export async function describePdf(reader: PdfReader, signal?: AbortSignal): Promise<readonly DocumentPage[]> {
  const pages: DocumentPage[] = []
  for (let i = 1; i <= reader.proxy.numPages; i++) {
    signal?.throwIfAborted()
    const page = await reader.proxy.getPage(i)
    const { width, height } = page.getViewport({ scale: 1 })
    if (!acceptablePageSize(width, height)) throw new Error(`PDF 第 ${i} 页的尺寸超限或无效。`)
    const content = await page.getTextContent()
    const text = content.items.flatMap(item => 'str' in item ? [item.str + (item.hasEOL ? '\n' : '')] : []).join(' ').trim().slice(0, maxSourceText)
    const id = crypto.randomUUID()
    pages.push({ id, width, height, text: text || null, scene: { id, objects: [] } })
  }
  return pages
}

export async function validatePdfPages(reader: PdfReader, pages: readonly DocumentPage[], signal?: AbortSignal) {
  if (reader.proxy.numPages !== pages.length) throw new Error('项目页数与内嵌 PDF 不一致。')
  for (const [i, page] of pages.entries()) {
    signal?.throwIfAborted()
    const viewport = (await reader.proxy.getPage(i + 1)).getViewport({ scale: 1 })
    if (viewport.width !== page.width || viewport.height !== page.height) throw new Error(`第 ${i + 1} 页尺寸与内嵌 PDF 不一致。`)
  }
}
