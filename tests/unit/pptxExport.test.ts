import { describe, expect, it } from 'vitest'
import { pptxFontFace, pptxLinePlacement, rasterizedPptxObject } from '../../src/export/pptxDocument'
import type { CanvasObject } from '../../src/core/scene'

describe('PPTX 原生对象映射', () => {
  it('点换算为英寸；负向直线保留倾斜方向，旋转到竖直时宽度为零', () => {
    expect(pptxLinePlacement({ x: 144, y: 144, dx: -72, dy: 144, rotation: 0 }))
      .toEqual({ x: 1.5, y: 1, w: 1, h: 2, flipV: true })
    expect(pptxLinePlacement({ x: 144, y: 144, dx: 72, dy: 0, rotation: 90 }))
      .toEqual({ x: 2, y: 1.5, w: 0, h: 1, flipV: false })
  })

  it('保留简单文字和直线；不使用 PowerPoint 默认箭头替代自有箭头样式', () => {
    const line = { type: 'line', id: 'l', x: 200, y: 180, rotation: 0, dx: 80, dy: 40, stroke: '#173245', strokeWidth: 3 } as const
    const text = { type: 'text', id: 't', x: 300, y: 300, rotation: 0, color: '#173245', text: '中文', fontSize: 24,
      fontFamily: 'Microsoft YaHei' } satisfies CanvasObject
    expect(rasterizedPptxObject(line)).toBe(false)
    expect(rasterizedPptxObject(text)).toBe(false)
    expect(rasterizedPptxObject({ ...line, type: 'arrow' })).toBe(true)
    expect(rasterizedPptxObject({ ...text, fontSize: 4001 })).toBe(true)
    expect(rasterizedPptxObject({ ...text, text: 'A\nB\n' })).toBe(true)
  })

  it('将 CSS 字体列表映射为合法的 OOXML 字体属性', () => {
    expect(pptxFontFace('"Microsoft YaHei", sans-serif')).toBe('Microsoft YaHei')
    expect(pptxFontFace('"A&B"')).toBe('A&amp;B')
    expect(pptxFontFace('sans-serif')).toBeUndefined()
  })
})
