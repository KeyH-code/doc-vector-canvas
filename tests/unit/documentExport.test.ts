import { describe, expect, it } from 'vitest'
import { pageRange, pageVisibility, pdfOverlayPlacement } from '../../src/export/documentExport'

describe('文档导出固定页框', () => {
  it('校验单页和页码段，去重且保持原页顺序', () => {
    expect(pageRange('5, 2-3，2', 5)).toEqual([1, 2, 4])
    for (const invalid of ['', '0', '6', '3-1', '1,', '2--3', '1e1', '1-999999999']) expect(pageRange(invalid, 5)).toBeUndefined()
  })

  it('考虑完整绘制范围而不是对象中心，并区分边界穿越', () => {
    const page = { width: 100, height: 100 }
    expect(pageVisibility(page, { left: 80, top: 48, width: 50, height: 4 })).toBe('partial')
    expect(pageVisibility(page, { left: 101, top: 48, width: 10, height: 4 })).toBe('outside')
    expect(pageVisibility(page, { left: 2, top: 47, width: 12, height: 6 })).toBe('inside')
  })

  it('将编辑层按旋转、偏移 CropBox 和 UserUnit 映射回 PDF 原坐标', () => {
    expect(pdfOverlayPlacement([2, 0, 0, -2, -20, 440], { width: 640, height: 400 }))
      .toEqual({ x: 10, y: 20, width: 320, height: 200, rotation: 0 })
    expect(pdfOverlayPlacement([0, 1, 1, 0, -20, -10], { width: 200, height: 320 }))
      .toEqual({ x: 330, y: 20, width: 200, height: 320, rotation: 90 })
  })
})
