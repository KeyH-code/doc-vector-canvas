import { describe, expect, it } from 'vitest'
import { appendSegment, fitCurve, makePolyline, pathTip } from '../../src/core/linePaths'
import { decodeProject, encodeProject } from '../../src/project/projectFile'

describe('折线路径', () => {
  it('续画保留旧段及编号，拒绝零长度，末端取最后一段方向', () => {
    const first = makePolyline({ x: 0, y: 0 }, { x: 50, y: 0 })!
    const next = appendSegment(first, { x: 50, y: -50 })!
    expect(next.segments).toEqual([...first.segments, { id: 1, to: { x: 50, y: -50 } }])
    expect(appendSegment(next, { x: 50, y: -50 })).toBeUndefined()
    expect(pathTip(next)).toEqual({ tip: { x: 50, y: -50 }, tangent: { x: 0, y: -50 } })
  })

  it('v2 保存折线，不让旧版本夹带路径或接受重复的段编号', () => {
    const first = makePolyline({ x: 0, y: 0 }, { x: 50, y: 0 })!
    const path = appendSegment(first, { x: 50, y: 50 })!
    const line = { id: 'line', type: 'arrow', x: 50, y: 50, dx: 50, dy: 50, rotation: 0, strokeWidth: 4, stroke: '#355985', path } as const
    const scene = { id: 'paths', objects: [line] }
    expect(decodeProject(encodeProject(scene))).toEqual({ ok: true, scene })
    expect(decodeProject(encodeProject(scene).replace('"version": 2', '"version": 1'))).toMatchObject({ ok: false })
    const broken = { ...path, segments: [path.segments[0], { ...path.segments[1], id: 0 }] }
    expect(decodeProject(encodeProject({ ...scene, objects: [{ ...line, path: broken }] }))).toMatchObject({ ok: false })
  })
})

describe('手绘曲线', () => {
  it('过滤短小抖动，保留首末点、S 的两个弯向与反向末端切线', () => {
    const gesture = [{ x: 0, y: 0 }, { x: 15, y: -16 }, { x: 18, y: -17 }, { x: 35, y: -22 }, { x: 50, y: 0 },
      { x: 65, y: 18 }, { x: 68, y: 19 }, { x: 80, y: 22 }, { x: 100, y: 0 }]
    const path = fitCurve(gesture, 3)!
    expect(path.start).toEqual(gesture[0])
    expect(pathTip(path).tip).toEqual(gesture.at(-1))
    expect(path.segments.length).toBeLessThan(gesture.length - 1)
    expect(path.segments.some(part => part.to.y > 15)).toBe(true)
    expect(path.segments.some(part => part.to.y < -15)).toBe(true)
    expect(pathTip(path).tangent.x).toBeGreaterThan(0)
    expect(pathTip(fitCurve([...gesture].reverse(), 3)!).tangent.x).toBeLessThan(0)
    expect(fitCurve([gesture[0], gesture[0]], 3)).toBeUndefined()
  })
})
