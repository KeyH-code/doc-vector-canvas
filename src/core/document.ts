import { imageAssetBytes, maxProjectImageBytes } from './imageAssets'
import { sameScene, type CanvasScene } from './scene'

export const maxDocumentBytes = 32 * 1024 * 1024
export const maxDocumentPages = 150
export const maxPageSide = 14_400
export const maxSourceText = 200_000

export type PdfSource = Readonly<{ kind: 'pdf'; data: string }>
export type DocumentPage = Readonly<{ id: string; width: number; height: number; text: string | null; scene: CanvasScene }>
export type DocumentCanvas = Readonly<{ source: PdfSource; pages: readonly DocumentPage[] }>

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
  if (!a || !b || a.source.kind !== b.source.kind || a.source.data !== b.source.data || a.pages.length !== b.pages.length) return false
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
