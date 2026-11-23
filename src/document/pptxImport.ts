import frameCode from 'virtual:pptx-render-frame'
import { fromBase64, toBase64 } from '../core/base64'
import { acceptablePageSize, maxDocumentBytes, maxDocumentPages, maxPptxBackgroundBytes, maxSourceText, pptxPngSize, type DocumentCanvas, type PptxSource } from '../core/document'
import type { CanvasScene } from '../core/scene'
import type { PageReader } from './pageReader'

const renderTimeoutMs = 45_000
export const pptxMime = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
type RenderedDeck = { width: number; height: number; text: (string | null)[]; pictures: ArrayBuffer[] }

function renderPptx(bytes: ArrayBuffer, signal: AbortSignal, onProgress: (page: number, total: number) => void): Promise<RenderedDeck> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe')
    const channel = new MessageChannel()
    const nonce = crypto.randomUUID()
    const deadline = Date.now() + renderTimeoutMs
    frame.title = 'PPTX 本地底稿渲染'
    frame.setAttribute('sandbox', 'allow-scripts')
    frame.setAttribute('aria-hidden', 'true')
    frame.tabIndex = -1
    frame.className = 'pptx-render-frame'
    const policy = `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data: blob:; font-src data: blob:; connect-src data: blob:; object-src 'none'; base-uri 'none'; form-action 'none'`
    frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"></head><body><script nonce="${nonce}">${frameCode.replace(/<\/script/gi, '<\\/script')}</script></body></html>`
    function cleanup() {
      window.clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      channel.port1.close()
      channel.port2.close()
      frame.remove()
    }
    function abort() { cleanup(); reject(signal.reason) }
    function timedOut() { cleanup(); reject(new Error('PPTX 渲染超时，请减少页数后重试。')) }
    const timer = window.setTimeout(timedOut, renderTimeoutMs)
    signal.addEventListener('abort', abort, { once: true })
    channel.port1.onmessageerror = () => { cleanup(); reject(new Error('无法接收 PPTX 底稿。')) }
    channel.port1.onmessage = ({ data }) => {
      if (Date.now() >= deadline) { timedOut(); return }
      if (data?.type === 'progress') {
        if (Number.isInteger(data.page) && Number.isInteger(data.total) && data.page > 0 && data.page <= data.total && data.total <= maxDocumentPages) {
          onProgress(data.page, data.total)
        }
        return
      }
      cleanup()
      if (data?.type === 'error' && typeof data.message === 'string') { reject(new Error(data.message)); return }
      if (data?.type === 'success') { resolve(data); return }
      reject(new Error('无法接收 PPTX 底稿。'))
    }
    frame.addEventListener('load', () => {
      frame.contentWindow?.postMessage({ type: 'render-pptx', bytes, deadline }, '*', [channel.port2, bytes])
    }, { once: true })
    document.body.append(frame)
  })
}

export async function importPptx(file: File, signal: AbortSignal, onProgress: (page: number, total: number) => void) {
  if (!file.size || file.size > maxDocumentBytes) throw new Error('PPTX 文件须大于 0 且不超过 32 MiB。')
  const bytes = await file.arrayBuffer()
  const { width, height, text, pictures } = await renderPptx(bytes, signal, onProgress)
  signal.throwIfAborted()
  if (typeof width !== 'number' || typeof height !== 'number' || !acceptablePageSize(width, height) || !Array.isArray(text) ||
      !Array.isArray(pictures) || !text.length || text.length > maxDocumentPages || pictures.length !== text.length ||
      !text.every(item => item === null || (typeof item === 'string' && item.length <= maxSourceText))) throw new Error('PPTX 的页面数据无效。')
  let size = 0
  const backgrounds: string[] = []
  for (const [i, picture] of pictures.entries()) {
    signal.throwIfAborted()
    if (!(picture instanceof ArrayBuffer) || !pptxPngSize(new Uint8Array(picture), width, height)) throw new Error(`PPTX 第 ${i + 1} 页的底稿无效。`)
    size += picture.byteLength
    if (size > maxPptxBackgroundBytes) throw new Error('PPTX 底稿合计超过 32 MiB。')
    backgrounds.push(toBase64(new Uint8Array(picture)))
  }
  const document: DocumentCanvas<PptxSource> = { source: { kind: 'pptx', backgrounds }, pages: text.map(value => {
    const id = crypto.randomUUID()
    return { id, width, height, text: value, scene: { id, objects: [] } }
  }) }
  const scene: CanvasScene = { id: crypto.randomUUID(), objects: [], document }
  return { scene, ...await preparePptx(backgrounds, signal) }
}

async function decodeBackground(data: string, signal?: AbortSignal) {
  signal?.throwIfAborted()
  const image = await createImageBitmap(new Blob([fromBase64(data)], { type: 'image/png' }), { imageOrientation: 'none' })
  if (signal?.aborted) { image.close(); signal.throwIfAborted() }
  return image
}

function createPptxReader(backgrounds: readonly string[]): PageReader {
  return {
    close: async () => {},
    async render(index, longSide, signal) {
      const bitmap = await decodeBackground(backgrounds[index], signal)
      try {
        const scale = Math.min(1, longSide / Math.max(bitmap.width, bitmap.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale))
        canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
        return canvas
      } finally { bitmap.close() }
    },
  }
}

export async function preparePptx(backgrounds: readonly string[], signal?: AbortSignal) {
  const reader = createPptxReader(backgrounds)
  try {
    const first = await reader.render(0, 1450, signal)
    for (let i = 1; i < backgrounds.length; i++) (await decodeBackground(backgrounds[i], signal)).close()
    return { reader, first }
  } catch (error) {
    signal?.throwIfAborted()
    throw new Error('无法解码 PPTX 底稿，文件可能损坏。', { cause: error })
  }
}
