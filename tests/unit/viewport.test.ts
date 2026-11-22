import { describe, expect, it } from 'vitest'
import { fitViewport, panViewport, viewToWorld, viewportMatrix, worldToView, zoomViewport } from '../../src/editor/viewport'

describe('画布视图不改变世界坐标', () => {
  const size = { width: 800, height: 520 }
  const view = { center: { x: -320, y: 750 }, zoom: 2 }

  it('往返坐标，尺寸变化保留世界中心', () => {
    expect(viewportMatrix(view, size)).toEqual([2, 0, 0, 2, 1040, -1240])
    const point = { x: -460, y: 800 }
    expect(viewToWorld(view, size, worldToView(view, size, point))).toEqual(point)
    expect(viewToWorld(view, size, { x: 400, y: 260 })).toEqual(view.center)
    expect(viewToWorld(view, { width: 1000, height: 520 }, { x: 500, y: 260 })).toEqual(view.center)
  })

  it('以 (240, 120) 缩放时锚点下的世界坐标不漂移', () => {
    const anchor = { x: 240, y: 120 }
    const zoomed = zoomViewport(view, size, anchor, 4)
    expect(zoomed.zoom).toBe(4)
    expect(viewToWorld(zoomed, size, anchor)).toEqual(viewToWorld(view, size, anchor))
    expect(zoomViewport(view, size, anchor, Infinity)).toBe(view)
    expect(zoomViewport(view, size, anchor, 400).zoom).toBe(8)
  })

  it('平移和适配支持正负坐标，按屏幕像素计算拖动', () => {
    expect(panViewport(view, { x: 120, y: -40 })).toEqual({ center: { x: -380, y: 770 }, zoom: 2 })
    expect(fitViewport(size, { left: -5300, top: 1800, width: 400, height: 300 }))
      .toEqual({ center: { x: -5100, y: 1950 }, zoom: 1 })
  })
})
