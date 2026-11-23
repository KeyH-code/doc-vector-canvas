import { fromBase64 } from './base64'
import { hasImagePayload, imageAssetBytes, imageHeader, maxProjectImageBytes } from './imageAssets'
import { sameScene, type CanvasScene } from './scene'

export const maxDocumentBytes = 32 * 1024 * 1024
export const maxDocumentPages = 150
export const maxPageSide = 14_400
export const maxSourceText = 200_000
export const maxPptxRasterSide = 1600
export const maxPptxBackgroundBytes = 32 * 1024 * 1024

export type PdfSource = Readonly<{ kind: 'pdf'; data: string }>
export type PptxSource = Readonly<{ kind: 'pptx'; backgrounds: readonly string[] }>
export type DocumentPage = Readonly<{ id: string; width: number; height: number; text: string | null; scene: CanvasScene }>
export type DocumentCanvas<S = PdfSource | PptxSource> = Readonly<{ source: S; pages: readonly DocumentPage[] }>

export function isPdfDocument(document: DocumentCanvas): document is DocumentCanvas<PdfSource> {
  return document.source.kind === 'pdf'
}

export function pptxPngSize(bytes: Uint8Array, width: number, height: number) {
  const image = imageHeader(bytes)
  if (!image || image.mime !== 'image/png' || image.width < 1 || image.height < 1 ||
      Math.max(image.width, image.height) > maxPptxRasterSide + 1) return
  const scale = Math.max(image.width, image.height) / Math.max(width, height)
  if (Math.abs(image.width - width * scale) > 1 || Math.abs(image.height - height * scale) > 1 || !hasImagePayload(bytes, 'image/png')) return
  return image
}

export function validPptxBackgrounds(backgrounds: unknown, pages: readonly DocumentPage[]): backgrounds is string[] {
  const first = pages[0]
  if (!Array.isArray(backgrounds) || backgrounds.length !== pages.length || !first ||
      !pages.every(page => page.width === first.width && page.height === first.height)) return false
  let size = 0
  return backgrounds.every((data: unknown) => {
    if (typeof data !== 'string' || !data.startsWith('iVBORw0KGgo') || data.length % 4 ||
        data.length > Math.ceil(maxPptxBackgroundBytes / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return false
    size += imageAssetBytes({ data })
    if (size > maxPptxBackgroundBytes) return false
    try {
      return !!pptxPngSize(fromBase64(data), first.width, first.height)
    } catch { return false }
  })
}

export function isPdfData(data: unknown): data is string {
  if (typeof data !== 'string' || !data.startsWith('JVBERi0') || data.length % 4 !== 0 ||
      data.length > Math.ceil(maxDocumentBytes / 3) * 4 || imageAssetBytes({ data }) > maxDocumentBytes) return false
  // Chunk validation avoids building a second decoded copy while reading project JSON.
  return /^[A-Za-z0-9+/]+={0,2}$/.test(data)
}

export function acceptablePageSize(width: unknown, height: unknown): boolean {
  return [width, height].every(value => typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= maxPageSide)
}

export function pageScene(project: CanvasScene, pageId?: string): CanvasScene {
  if (!project.document) return project
  const page = pageId === undefined ? project.document.pages[0] : project.document.pages.find(page => page.id === pageId)
  if (!page) throw new Error('项目中没有该页面。')
  return page.scene
}

export function changedPage(before: CanvasScene, after: CanvasScene): string | undefined {
  if (!before.document || !after.document || before.document.source !== after.document.source) return
  return after.document.pages.find((page, index) => page.scene !== before.document?.pages[index]?.scene)?.id
}

export function sameDocument(a?: DocumentCanvas, b?: DocumentCanvas): boolean {
  if (a === b) return true
  if (!a || !b || a.pages.length !== b.pages.length) return false
  const source = a.source, otherSource = b.source
  if (source !== otherSource && (source.kind === 'pdf' ? otherSource.kind !== 'pdf' || source.data !== otherSource.data
    : otherSource.kind !== 'pptx' || source.backgrounds.length !== otherSource.backgrounds.length ||
      !source.backgrounds.every((data, i) => data === otherSource.backgrounds[i]))) return false
  return a.pages.every((page, i) => {
    const other = b.pages[i]
    return page === other || (page.id === other.id && page.width === other.width && page.height === other.height &&
      page.text === other.text && sameScene(page.scene, other.scene))
  })
}

export function documentImagesWithinLimit(pages: readonly DocumentPage[]) {
  let bytes = 0
  for (const { scene } of pages) for (const asset of scene.images ?? []) {
    bytes += imageAssetBytes(asset)
    if (bytes > maxProjectImageBytes) return false
  }
  return true
}
