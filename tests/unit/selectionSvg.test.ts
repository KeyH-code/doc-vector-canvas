import { describe, expect, it } from 'vitest'
import { selectionInPaintOrder, selectionViewBox } from '../../src/export/selectionSvg'
import { rectangle, text } from './fixtures/scenes'

describe('选区 SVG 的对象与输出边界', () => {
  it('只选入指定的对象，去除重复和不存在的 ID，保留场景层叠顺序', () => {
    const back = rectangle('back'), front = text('front')
    expect(selectionInPaintOrder([back, rectangle('outside'), front], ['front', 'missing', 'back', 'front']))
      .toEqual([back, front])
    expect(selectionInPaintOrder([back, front], [])).toEqual([])
  })

  it('合并旋转后边界并向外取整，保留描边余量与负坐标', () => {
    expect(selectionViewBox([
      { left: -15.3, top: 8.4, width: 93.7, height: 57.9 },
      { left: 46.2, top: -22.1, width: 48.9, height: 14.4 },
    ])).toEqual({ x: -20, y: -27, width: 120, height: 98 })
  })

  it('无选区或无法表示为有限 SVG 边界时不生成视图', () => {
    expect(selectionViewBox([])).toBeUndefined()
    expect(selectionViewBox([{ left: 0, top: 0, width: Infinity, height: 4 }])).toBeUndefined()
    expect(selectionViewBox([{ left: 1e308, top: 0, width: 1e308, height: 4 }])).toBeUndefined()
  })
})
