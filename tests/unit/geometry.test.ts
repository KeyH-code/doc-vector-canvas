import { describe, expect, it } from 'vitest'
import { drawingGeometry, polygonVertices, strokePoints } from '../../src/core/geometry'
import { createHistory, submit } from '../../src/core/history'
import type { CanvasObject } from '../../src/core/scene'

describe('绘图手势使用场景坐标', () => {
  it('反向拖拽同样得到规范化的矩形和椭圆', () => {
    const points = [{ x: 130, y: 90 }, { x: 30, y: 50 }]
    for (const type of ['rectangle', 'ellipse'] as const) {
      expect(drawingGeometry(type, points)).toEqual({ type, x: 80, y: 70, width: 100, height: 40 })
    }
  })

  it('不接受零长度直线、点状笔迹或无面积图形', () => {
    const dot = [{ x: 8, y: 8 }, { x: 8, y: 8 }]
    for (const type of ['rectangle', 'ellipse', 'square', 'diamond', 'star', 'line', 'arrow', 'stroke'] as const) {
      expect(drawingGeometry(type, dot)).toBeUndefined()
    }
    expect(drawingGeometry('ellipse', [{ x: 40, y: 25 }, { x: 40, y: 55 }])).toBeUndefined()
  })

  it('反向拖出等边正方形，菱形和星形保留宽高', () => {
    const points = [{ x: 130, y: 90 }, { x: 30, y: 50 }]
    expect(drawingGeometry('square', points)).toEqual({ type: 'square', x: 110, y: 70, width: 40, height: 40 })
    for (const type of ['diamond', 'star'] as const) {
      expect(drawingGeometry(type, points)).toEqual({ type, x: 80, y: 70, width: 100, height: 40 })
    }
  })

  it('菱形和五角星顶点顺序固定，星形凹点位于尖端之间', () => {
    expect(polygonVertices('diamond', 100, 60)).toEqual([{ x: 0, y: -30 }, { x: 50, y: 0 }, { x: 0, y: 30 }, { x: -50, y: 0 }])
    const star = polygonVertices('star', 100, 60)
    expect(star).toHaveLength(10)
    expect(star[0]).toEqual({ x: 0, y: -30 })
    expect(star[1].x).toBeGreaterThan(0)
    expect(star[1].x).toBeLessThan(star[2].x)
    expect(Math.max(...star.map(point => point.x))).toBeCloseTo(50)
    expect(Math.max(...star.map(point => point.y))).toBeCloseTo(30)
    polygonVertices('star', 200, 180).forEach(({ x, y }, index) => {
      expect(x).toBeCloseTo(star[index].x * 2)
      expect(y).toBeCloseTo(star[index].y * 3)
    })
  })

  it('保留箭头方向，箭头尖端位于拖拽的结束端', () => {
    const arrow = { type: 'arrow', x: 40, y: 25, dx: -60, dy: 0 } as const
    expect(drawingGeometry('arrow', [{ x: 70, y: 25 }, { x: 10, y: 25 }])).toEqual(arrow)
    const [start, tip, head] = strokePoints(arrow)
    expect(start).toEqual({ x: 30, y: 0 })
    expect(tip).toEqual({ x: -30, y: 0 })
    expect(head.x).toBeGreaterThan(tip.x)
  })

  it('笔迹按路径范围定位，保留原有点序和局部坐标', () => {
    expect(drawingGeometry('stroke', [{ x: 40, y: 40 }, { x: 75, y: 20 }, { x: 50, y: 65 }])).toEqual({
      type: 'stroke', x: 57.5, y: 42.5, points: [{ x: -17.5, y: -2.5 }, { x: 17.5, y: -22.5 }, { x: -7.5, y: 22.5 }],
    })
  })

  it('同坐标笔迹不增加历史，外部数组变更不污染已有场景', () => {
    const points = [{ x: -10, y: 0 }, { x: 10, y: 0 }]
    const object: CanvasObject = { id: 's', type: 'stroke', x: 30, y: 20, rotation: 0, stroke: '#355985', strokeWidth: 3, points }
    const result = submit(createHistory({ id: 'paper', objects: [] }), [{ type: 'create', object }])
    expect(result.ok).toBe(true)
    const same = submit(result.history, [{ type: 'update', id: 's', changes: { points: points.map(point => ({ ...point })) } }])
    expect(same.history).toBe(result.history)
    points[0].x = -999
    expect(result.history.scene.objects[0]).toMatchObject({ points: [{ x: -10, y: 0 }, { x: 10, y: 0 }] })
  })
})
