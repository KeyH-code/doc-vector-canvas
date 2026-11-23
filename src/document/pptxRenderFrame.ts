import { parse, slideToPng } from '@web-ppt/core'
import { maxPptxBackgroundBytes, maxPptxRasterSide } from '../core/document'
import { PptxInputError, pptxZipLimits, readPptxPackage } from './pptxPackage'

window.addEventListener('message', function receive(event) {
  if (event.source !== window.parent || event.data?.type !== 'render-pptx' || !(event.data.bytes instanceof ArrayBuffer) ||
      !Number.isFinite(event.data.deadline) || !event.ports[0]) return
  window.removeEventListener('message', receive)
  void render(event.data.bytes, event.ports[0], event.data.deadline)
})

async function render(input: ArrayBuffer, port: MessagePort, deadline: number) {
  let outputBytes = 0, blockedResource = false
  const checkDeadline = () => {
    if (Date.now() >= deadline) throw new PptxInputError('PPTX 渲染超时，请减少页数后重试。')
  }
  const yieldForControls = () => new Promise<void>(resolve => window.setTimeout(resolve, 0))
  document.addEventListener('securitypolicyviolation', event => {
    if (/^(?:https?|file|ftp):/i.test(event.blockedURI)) blockedResource = true
  })
  try {
    const bytes = new Uint8Array(input)
    const { width, height, slides } = readPptxPackage(bytes)
    await yieldForControls()
    checkDeadline()
    // Read source part IDs to confirm that the renderer and preflight are describing the same pages.
    const deck = await parse(bytes, { zip: pptxZipLimits, edit: true })
    try {
      if (deck.source !== 'pptx' || deck.slides.length !== slides.length ||
          Math.abs(deck.width * .75 - width) > .75 || Math.abs(deck.height * .75 - height) > .75) {
        throw new PptxInputError('PPTX 页数或尺寸与原稿不一致。')
      }
      const pictures: ArrayBuffer[] = []
      const scale = maxPptxRasterSide / Math.max(deck.width, deck.height)
      for (const [i, slide] of deck.slides.entries()) {
        await yieldForControls()
        checkDeadline()
        if (slide.editInfo?.origin.part !== slides[i].part) throw new PptxInputError('PPTX 的底稿页序与原稿不一致。')
        port.postMessage({ type: 'progress', page: i + 1, total: slides.length })
        const png = await slideToPng(deck, slide, scale, { strictResources: true })
        outputBytes += png.size
        if (png.type !== 'image/png' || !png.size) throw new PptxInputError(`PPTX 第 ${i + 1} 页无法生成底稿。`)
        if (outputBytes > maxPptxBackgroundBytes) throw new PptxInputError('PPTX 底稿合计超过 32 MiB。')
        pictures.push(await png.arrayBuffer())
      }
      checkDeadline()
      if (blockedResource) throw new PptxInputError('PPTX 包含被阻止的外部资源。')
      port.postMessage({ type: 'success', width, height, text: slides.map(slide => slide.text), pictures }, pictures)
    } finally { deck.dispose?.() }
  } catch (error) {
    const message = error instanceof PptxInputError ? error.message :
      blockedResource ? 'PPTX 包含被阻止的外部资源。' : '无法解析或渲染 PPTX，文件可能损坏、超限或使用了不支持的资源。'
    port.postMessage({ type: 'error', message })
  } finally { port.close() }
}
