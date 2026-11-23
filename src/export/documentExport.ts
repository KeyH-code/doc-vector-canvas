export type PageSize = Readonly<{ width: number; height: number }>
export type PageBounds = PageSize & Readonly<{ left: number; top: number }>

export function pageRange(source: string, total: number): number[] | undefined {
  const selected = new Set<number>()
  for (const token of source.trim().split(/[,，]/)) {
    const match = /^(\d+)\s*(?:[-–]\s*(\d+))?$/.exec(token.trim())
    if (!match) return
    const first = Number(match[1]), last = match[2] === undefined ? first : Number(match[2])
    if (first < 1 || last > total || last < first || !Number.isSafeInteger(last)) return
    for (let page = first; page <= last; page++) selected.add(page - 1)
  }
  return [...selected].sort((a, b) => a - b)
}

export function pageVisibility(page: PageSize, bounds: PageBounds) {
  const right = bounds.left + bounds.width, bottom = bounds.top + bounds.height
  if (right <= 0 || bottom <= 0 || bounds.left >= page.width || bounds.top >= page.height) return 'outside'
  if (bounds.left >= 0 && bounds.top >= 0 && right <= page.width && bottom <= page.height) return 'inside'
  return 'partial'
}

/** Invert the reader transform so the page crop, rotation and UserUnit are shared by preview and export. */
export function pdfOverlayPlacement(matrix: readonly number[], page: PageSize) {
  const [a, b, c, d, e, f] = matrix, det = a * d - b * c
  if (!Number.isFinite(det) || det === 0) throw new Error('PDF 页面坐标无效。')
  const originX = -e, originY = page.height - f
  const ux = d / det, uy = -b / det
  return { x: (d * originX - c * originY) / det, y: (-b * originX + a * originY) / det,
    width: page.width * Math.hypot(ux, uy), height: page.height * Math.hypot(c / det, a / det),
    rotation: Math.atan2(uy, ux) * 180 / Math.PI }
}
