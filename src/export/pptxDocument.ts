import { IText, type FabricObject } from 'fabric'
import PptxGenJS from 'pptxgenjs'
import type { DocumentCanvas, PptxSource } from '../core/document'
import { toBase64 } from '../core/base64'
import { imageAssetBytes, imageDataUrl, maxProjectImageBytes, type ImageAsset } from '../core/imageAssets'
import type { CanvasObject, LineObject } from '../core/scene'
import { pageVisibility, type PageBounds, type PageSize } from './documentExport'
import { maxOverlayBytes, overlaySize, pageOverlay, paintedBounds } from './pageOverlay'

const inches = (pt: number) => pt / 72
const rgb = (color: string) => color.slice(1).toUpperCase()
const rotation = (degrees: number) => ((degrees % 360) + 360) % 360
const unsafeText = /[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]/
const maxPptxRasterPixels = 100_000_000
const genericFace = /^(?:serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-(?:serif|sans-serif|monospace|rounded))$/i
const xmlEscapes = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }
type Slide = ReturnType<PptxGenJS['addSlide']>
type Shapes = PptxGenJS['ShapeType']

export function pptxFontFace(css: string) {
  // OOXML takes one font family, not a CSS fallback list. PptxGenJS inserts its value verbatim.
  const token = /^\s*(?:"([^"\\]+)"|'([^'\\]+)'|([^,\s"'\\][^,"'\\]*))\s*(?:,|$)/.exec(css)
  const face = token && (token[1] ?? token[2] ?? token[3]).trim()
  if (!face || unsafeText.test(face) || /[\r\n\t]/.test(face) || genericFace.test(face)) return undefined
  return face.replace(/[&<>"']/g, ch => xmlEscapes[ch as keyof typeof xmlEscapes])
}

export function rasterizedPptxObject(data: CanvasObject, bounds?: PageBounds, page?: PageSize) {
  if (data.type === 'text') {
    if (data.fontSize < 1 || data.fontSize > 4000 || unsafeText.test(data.text) || /[\r\n\t]/.test(data.text) || !pptxFontFace(data.fontFamily)) return true
    if (bounds && page) {
      const margin = Math.max(data.fontSize / 2, bounds.width * .10)
      return pageVisibility(page, { left: bounds.left - margin, top: bounds.top - margin,
        width: bounds.width + 2 * margin, height: bounds.height + 2 * margin }) !== 'inside'
    }
    return false
  }
  if (data.type === 'image') return false
  if (data.strokeWidth > 1584) return true
  if (data.type === 'line') return !!data.path || data.strokeWidth === 0 || (!data.dx && !data.dy)
  return data.type !== 'rectangle' && data.type !== 'square' && data.type !== 'ellipse' && data.type !== 'diamond'
}

export function pptxLinePlacement(data: Pick<LineObject, 'x' | 'y' | 'dx' | 'dy' | 'rotation'>) {
  const rad = rotation(data.rotation) * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad)
  const dx = data.dx * cos - data.dy * sin, dy = data.dx * sin + data.dy * cos
  const width = Math.abs(dx) < 1e-9 ? 0 : Math.abs(dx), height = Math.abs(dy) < 1e-9 ? 0 : Math.abs(dy)
  return { x: inches(data.x - width / 2), y: inches(data.y - height / 2), w: inches(width), h: inches(height),
    flipV: width > 0 && height > 0 && (dx < 0) !== (dy < 0) }
}

function addNative(slide: Slide, shapes: Shapes, data: CanvasObject, view: FabricObject, image?: { asset: ImageAsset; path: string }) {
  const centerBox = (width: number, height: number) => ({
    x: inches(data.x - width / 2), y: inches(data.y - height / 2), w: inches(width), h: inches(height), rotate: rotation(data.rotation),
  })
  if (data.type === 'text' && view instanceof IText) {
    slide.addText(data.text, { ...centerBox(view.width, view.height), margin: 0, breakLine: false, wrap: false,
      valign: 'middle', fontFace: pptxFontFace(data.fontFamily), fontSize: data.fontSize, color: rgb(data.color), objectName: '新增文字' })
    return
  }
  if (data.type === 'image') {
    if (!image) throw new Error('找不到要导出的图片。')
    slide.addImage({ ...centerBox(data.width, data.height), path: image.path, data: imageDataUrl(image.asset), objectName: '新增图片' })
    return
  }
  if (data.type === 'text' || data.type === 'arrow' || data.type === 'stroke' || data.type === 'star') throw new Error('未知的原生对象。')
  const line = { color: rgb(data.stroke), width: data.strokeWidth, transparency: data.strokeWidth ? 0 : 100,
    dashType: data.strokeStyle === 'dashed' ? 'dash' as const : 'solid' as const }
  if (data.type === 'line') {
    slide.addShape(shapes.line, { ...pptxLinePlacement(data), line, objectName: '新增直线' })
    return
  }
  if (!('fill' in data)) throw new Error('未知的原生对象。')
  const shape = data.type === 'ellipse' ? shapes.ellipse : data.type === 'diamond' ? shapes.diamond : shapes.rect
  slide.addShape(shape, { ...centerBox(data.width, data.height), fill: { color: data.fill === 'transparent' ? 'FFFFFF' : rgb(data.fill),
    transparency: data.fill === 'transparent' ? 100 : 0 }, line, objectName: '新增图形' })
}

// Crop to actual ink after clipping the layer to the original page. A small transparent picture
// does not cover unrelated editable objects in PowerPoint's selection surface.
async function clippedPicture(canvas: HTMLCanvasElement, remaining: number) {
  const { width, height } = canvas, ctx = canvas.getContext('2d')!
  let left = width, top = height, right = 0, bottom = 0
  for (let y = 0; y < height; y += 64) {
    const rows = Math.min(64, height - y), strip = ctx.getImageData(0, y, width, rows).data
    for (let i = 3; i < strip.length; i += 4) if (strip[i]) {
      const pixel = i >> 2, px = pixel % width, py = y + Math.floor(pixel / width)
      left = Math.min(left, px); right = Math.max(right, px + 1)
      top = Math.min(top, py); bottom = Math.max(bottom, py + 1)
    }
  }
  if (left >= right || top >= bottom) return
  const image = document.createElement('canvas')
  image.width = right - left; image.height = bottom - top
  image.getContext('2d')!.drawImage(canvas, left, top, image.width, image.height, 0, 0, image.width, image.height)
  try {
    const blob = await new Promise<Blob>((resolve, reject) => image.toBlob(result => result ? resolve(result) : reject(new Error('PPTX 编辑层无法编码。')), 'image/png'))
    if (blob.size > remaining) throw new Error('PPTX 编辑层合计超过 32 MiB；请缩小导出范围。')
    return { left, top, width: image.width, height: image.height, bytes: blob.size,
      data: `data:image/png;base64,${toBase64(new Uint8Array(await blob.arrayBuffer()))}` }
  } finally { image.width = 0; image.height = 0 }
}

export async function exportPptx(project: DocumentCanvas<PptxSource>, indexes: readonly number[]): Promise<ArrayBuffer> {
  if (!indexes.length || indexes.some(index => !Number.isSafeInteger(index) || !project.pages[index])) throw new Error('请选择有效页码。')
  const { width, height } = project.pages[0]
  if ([width, height].some(side => side < 72 || side > 4032) || project.pages.some(p => p.width !== width || p.height !== height)) {
    throw new Error('PPTX 页面尺寸不在 PowerPoint 支持的范围内（1～56 英寸），不会自动调整原尺寸。')
  }
  const pptx = new PptxGenJS()
  pptx.defineLayout({ name: '原始尺寸', width: inches(width), height: inches(height) })
  pptx.layout = '原始尺寸'
  let bytes = 0, nativeImageBytes = 0, rasterPixels = 0
  for (const index of [...new Set(indexes)].sort((a, b) => a - b)) {
    const page = project.pages[index], slide = pptx.addSlide()
    slide.background = { data: `data:image/png;base64,${project.source.backgrounds[index]}` }
    if (!page.scene.objects.length) continue
    const { canvas, objects, images } = pageOverlay(page)
    try {
      const pixels = overlaySize(page)
      const scaleX = pixels.width / width, scaleY = pixels.height / height
      const imagePaths = new Map<string, string>()
      for (const { data, view } of objects) {
        const bounds = paintedBounds(view, canvas.getContext()), visibility = pageVisibility(page, bounds)
        if (visibility === 'outside') continue
        if (visibility === 'inside' && !rasterizedPptxObject(data, bounds, page)) {
          if (data.type !== 'image') { addNative(slide, pptx.ShapeType, data, view); continue }
          const asset = images.get(data.assetId)
          if (!asset) throw new Error('找不到要导出的图片。')
          let path = imagePaths.get(data.assetId)
          if (!path) {
            nativeImageBytes += imageAssetBytes(asset)
            if (nativeImageBytes > maxProjectImageBytes) throw new Error('PPTX 新增图片合计超过 40 MiB；请减少导出页数或图片。')
            path = `page-${index}-asset-${imagePaths.size}.${asset.mime === 'image/png' ? 'png' : 'jpeg'}`
            imagePaths.set(data.assetId, path)
          }
          // A stable path plus embedded data lets PptxGenJS reuse one media part per slide, with no fetch.
          addNative(slide, pptx.ShapeType, data, view, { asset, path })
          continue
        }
        // Render each complex object into its own bounded viewport so its selection box is local.
        const left = Math.max(0, Math.floor(bounds.left * scaleX) - 2), top = Math.max(0, Math.floor(bounds.top * scaleY) - 2)
        const right = Math.min(pixels.width, Math.ceil((bounds.left + bounds.width) * scaleX) + 2)
        const bottom = Math.min(pixels.height, Math.ceil((bounds.top + bounds.height) * scaleY) + 2)
        rasterPixels += (right - left) * (bottom - top)
        if (rasterPixels > maxPptxRasterPixels) throw new Error('PPTX 编辑层合计渲染量过大；请减少导出页数或复杂对象。')
        canvas.setDimensions({ width: right - left, height: bottom - top })
        canvas.setViewportTransform([scaleX, 0, 0, scaleY, -left, -top])
        canvas.add(view)
        canvas.renderAll()
        const picture = await clippedPicture(canvas.getElement(), maxOverlayBytes - bytes)
        canvas.remove(view)
        if (picture) {
          bytes += picture.bytes
          // Round endpoints before subtracting so independent OOXML rounding cannot grow past the original edge.
          const emu = (px: number, scale: number) => Math.round(px / scale * 12700)
          const x = emu(left + picture.left, scaleX), y = emu(top + picture.top, scaleY)
          const w = emu(left + picture.left + picture.width, scaleX) - x
          const h = emu(top + picture.top + picture.height, scaleY) - y
          slide.addImage({ data: picture.data, x: x / 914400, y: y / 914400,
            w: w / 914400, h: h / 914400, objectName: '裁切或复杂对象' })
        }
      }
    } finally { await canvas.dispose() }
  }
  const output = await pptx.write({ outputType: 'arraybuffer', compression: true })
  if (!(output instanceof ArrayBuffer)) throw new Error('无法生成 PPTX 文件。')
  return output
}
