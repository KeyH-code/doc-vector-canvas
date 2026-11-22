import { describe, expect, it } from 'vitest'
import { captureSelection, offsetCopies, resolveEndpoints, snapToBoundary } from '../../src/core/connections'
import { polygonVertices } from '../../src/core/geometry'
import { createHistory, redo, submit, undo } from '../../src/core/history'
import type { BoxObject, CanvasScene, LineObject } from '../../src/core/scene'

const style = { rotation: 0, stroke: '#355985', strokeWidth: 4 }
const a: BoxObject = { ...style, type: 'rectangle', id: 'a', x: 100, y: 100, width: 80, height: 60, fill: '#e0eaf3' }
const b: BoxObject = { ...a, type: 'ellipse', id: 'b', x: 300, width: 100, height: 60 }
const arrow: LineObject = { ...style, type: 'arrow', id: 'edge', x: 200, y: 100, dx: 100, dy: 0,
  startBinding: { targetId: 'a', kind: 'edge', edge: 1, t: .75 },
  endBinding: { targetId: 'b', kind: 'ellipse', angle: Math.PI } }
const scene: CanvasScene = { id: 'links', objects: [a, b, arrow] }

describe('显式端点合同', () => {
  it('宿主平移、缩放与旋转只派生端点，不写入线记录', () => {
    const history = createHistory(scene)
    const bound = history.scene.objects[2] as LineObject
    expect(resolveEndpoints(bound, history.scene.objects)).toEqual({ start: { x: 140, y: 115 }, end: { x: 250, y: 100 } })
    const moved = submit(history, [{ type: 'update', id: 'a', changes: { x: 120, y: 130, width: 160, height: 80, rotation: 90 } }],
      { sceneId: scene.id, writableIds: ['a'] })
    expect(moved.ok).toBe(true)
    expect(moved.history.scene.objects[2]).toBe(bound)
    expect(resolveEndpoints(bound, moved.history.scene.objects)).toEqual({ start: { x: 100, y: 210 }, end: { x: 250, y: 100 } })
    expect(undo(moved.history)).toMatchObject({ scene: history.scene })
  })

  it('删除宿主保留原端点、线 ID 和另一个连接，撤销恢复关系', () => {
    const original = createHistory(scene)
    const removed = submit(original, [{ type: 'delete', id: 'a' }])
    expect(removed.ok).toBe(true)
    const remaining = removed.history.scene.objects[1] as LineObject
    expect(remaining).not.toHaveProperty('startBinding')
    expect(remaining).toMatchObject({ id: 'edge', endBinding: arrow.endBinding })
    expect(resolveEndpoints(remaining, removed.history.scene.objects)).toEqual(resolveEndpoints(arrow, scene.objects))
    const restored = undo(removed.history)
    expect(restored.scene).toEqual(original.scene)
    expect(redo(restored).scene).toEqual(removed.history.scene)
  })

  it('越权删除、非法边/弧、非宿主或缺失目标的批次保持场景和重做', () => {
    const original = createHistory(scene)
    const withRedo = undo(submit(original, [{ type: 'update', id: 'a', changes: { x: 120 } }]).history)
    const scoped = submit(withRedo, [{ type: 'update', id: 'a', changes: { x: 200 } }, { type: 'delete', id: 'a' }],
      { sceneId: scene.id, writableIds: ['a'] })
    expect(scoped).toMatchObject({ ok: false, code: 'out-of-scope', index: 1 })
    expect(scoped.history).toBe(withRedo)
    for (const startBinding of [
      { ...arrow.startBinding!, targetId: 'missing' },
      { ...arrow.startBinding!, targetId: 'edge' },
      { targetId: 'a', kind: 'edge', edge: 4, t: .5 },
      { targetId: 'a', kind: 'ellipse', angle: 1 },
      { targetId: 'b', kind: 'ellipse', angle: Infinity },
      { targetId: 'a', kind: 'edge', edge: 0, t: -1 },
    ] as const) {
      const result = submit(withRedo, [{ type: 'update', id: 'a', changes: { x: 200 } },
        { type: 'update', id: 'edge', changes: { startBinding } }])
      expect(result).toMatchObject({ ok: false, index: 1 })
      expect(result.history).toBe(withRedo)
    }
  })

  it('绑定无效编号后再删除宿主，也不能把无效命令隐藏为自由端', () => {
    const history = createHistory(scene)
    const result = submit(history, [
      { type: 'update', id: arrow.id, changes: { startBinding: { targetId: a.id, kind: 'edge', edge: 5, t: .5 } } },
      { type: 'delete', id: a.id },
    ])
    expect(result).toMatchObject({ ok: false, code: 'invalid-connection', index: 0 })
    expect(result.history).toBe(history)
  })

  it('受限命令解除已移动宿主的绑定时在原可见位置落下，撤销恢复', () => {
    const history = createHistory(scene)
    const moved = submit(history, [{ type: 'update', id: 'a', changes: { x: 200 } }]).history
    const line = moved.scene.objects[2] as LineObject
    const detached = submit(moved, [{ type: 'update', id: line.id, changes: { startBinding: undefined } }],
      { sceneId: scene.id, writableIds: [line.id] })
    expect(detached.ok).toBe(true)
    const free = detached.history.scene.objects[2] as LineObject
    expect(free).not.toHaveProperty('startBinding')
    expect(resolveEndpoints(free, detached.history.scene.objects)).toEqual(resolveEndpoints(line, moved.scene.objects))
    expect(undo(detached.history).scene).toBe(moved.scene)
  })

  it('同批前向引用的线被复制时，副本在未来宿主的实际边界处解除', () => {
    const result = submit(createHistory({ id: 'empty', objects: [] }), [
      { type: 'create', object: arrow }, { type: 'duplicate', id: arrow.id, newId: 'copy' },
      { type: 'create', object: a }, { type: 'create', object: b },
    ])
    expect(result.ok).toBe(true)
    const copy = result.history.scene.objects[1] as LineObject
    expect(copy).not.toHaveProperty('startBinding')
    expect(resolveEndpoints(copy, [])).toEqual(resolveEndpoints(arrow, [a, b]))
  })

  it('重复写入相同位置不进历史，且后续改动传入的锚点不会污染场景', () => {
    const history = createHistory(scene)
    const same = submit(history, [{ type: 'update', id: 'edge', changes: { startBinding: { ...arrow.startBinding! } } }])
    expect(same.history).toBe(history)
    const startBinding = { targetId: 'a', kind: 'edge' as const, edge: 3, t: .55 }
    const next = submit(history, [{ type: 'update', id: 'edge', changes: { startBinding } }])
    startBinding.t = .9
    expect(next.history.scene.objects[2]).toMatchObject({ startBinding: { t: .55 } })
  })

  it('吸附用屏幕像素半径；最近优先，等距取上层，椭圆取实际边界', () => {
    expect(snapToBoundary([a], { x: 100, y: 100 }, 1)).toBeUndefined()
    expect(snapToBoundary([a], { x: 144, y: 115 }, 2)?.point).toEqual({ x: 140, y: 115 })
    expect(snapToBoundary([a], { x: 144, y: 115 }, 4)).toBeUndefined()
    const upper = { ...a, id: 'upper' }
    expect(snapToBoundary([a, upper], { x: 144, y: 115 }, 1)?.binding.targetId).toBe('upper')
    expect(snapToBoundary([a, { ...upper, x: 98 }], { x: 144, y: 115 }, 1)?.binding.targetId).toBe('a')
    const near = snapToBoundary([b], { x: 332, y: 126 }, 1)!
    const local = { x: near.point.x - b.x, y: near.point.y - b.y }
    expect((local.x / 50) ** 2 + (local.y / 30) ** 2).toBeCloseTo(1, 10)
    const dot = (332 - near.point.x) * (-local.y * 50 / 30) + (126 - near.point.y) * (local.x * 30 / 50)
    expect(dot).toBeCloseTo(0, 8) // residual perpendicular to the ellipse tangent
  })

  it('正方形、菱形及旋转星形按实际边吸附，星形凹边不是包围框', () => {
    const square: BoxObject = { ...a, type: 'square', height: 80 }
    expect(snapToBoundary([square], { x: 143, y: 115 }, 2)?.binding).toEqual({ targetId: 'a', kind: 'edge', edge: 1, t: .6875 })
    const diamond: BoxObject = { ...a, type: 'diamond', rotation: 90 }
    expect(snapToBoundary([diamond], { x: 115, y: 120 }, 4)?.binding).toMatchObject({ kind: 'edge', edge: 0, t: .5 })
    const star: BoxObject = { ...a, type: 'star', width: 180, height: 120, rotation: 90 }
    const [p, q] = polygonVertices('star', star.width, star.height).slice(1, 3)
    const point = { x: star.x - (p.y + q.y) / 2, y: star.y + (p.x + q.x) / 2 }
    const result = snapToBoundary([star], point, 4)
    expect(result?.binding).toMatchObject({ edge: 1, t: expect.closeTo(.5, 10) })
    expect(result?.point.x).toBeCloseTo(point.x, 10)
    expect(result?.point.y).toBeCloseTo(point.y, 10)
    expect(snapToBoundary([star], { x: star.x + 60, y: star.y + 90 }, 4)).toBeUndefined()
  })

  it('复制只重映射同选宿主，并保存未复制宿主处的实际端点', () => {
    // Connector drawn below hosts, so its reference may point forward in paint order.
    const objects = [arrow, a, b]
    const copies = (ids: string[]) => offsetCopies(captureSelection(objects, ids), id => `${id}-copy`, { x: 24, y: 24 })
    const [line, newA] = copies(['a', 'edge']) as [LineObject, BoxObject]
    expect(line.startBinding?.targetId).toBe(newA.id)
    expect(line.endBinding).toBeUndefined()
    expect(resolveEndpoints(line, [line, newA])).toEqual({ start: { x: 164, y: 139 }, end: { x: 274, y: 124 } })
    const [justLine] = copies(['edge']) as [LineObject]
    expect(justLine).not.toHaveProperty('startBinding')
    expect(justLine).not.toHaveProperty('endBinding')
    expect(resolveEndpoints(justLine, [])).toEqual(resolveEndpoints(line, [line, newA]))
    expect(copies(['a']).map(object => object.id)).toEqual(['a-copy'])
    const paste = submit(createHistory({ id: 'empty', objects: [] }), copies(['a', 'b', 'edge']).map(object => ({ type: 'create', object })))
    expect(paste.ok).toBe(true)
    expect(paste.history.scene.objects[0]).toMatchObject({ startBinding: { targetId: 'a-copy' }, endBinding: { targetId: 'b-copy' } })
    expect(undo(paste.history).scene.objects).toEqual([])
  })

  it('两个端点暂时重合不丢连接，之后移开仍恢复，全部宿主删除后仍保留线 ID', () => {
    const right = { ...a, id: 'right', x: 180 }
    const joined: LineObject = { ...arrow, startBinding: { targetId: 'a', kind: 'edge', edge: 1, t: .5 },
      endBinding: { targetId: 'right', kind: 'edge', edge: 3, t: .5 } }
    const history = createHistory({ id: 'overlap', objects: [a, right, joined] })
    expect(resolveEndpoints(joined, history.scene.objects)).toEqual({ start: { x: 140, y: 100 }, end: { x: 140, y: 100 } })
    const moved = submit(history, [{ type: 'update', id: 'right', changes: { x: 220 } }])
    expect(resolveEndpoints(joined, moved.history.scene.objects).end.x).toBe(180)
    const deleted = submit(history, [{ type: 'delete', id: a.id }, { type: 'delete', id: right.id }])
    expect(deleted.ok).toBe(true)
    expect(deleted.history.scene.objects).toHaveLength(1)
    expect(deleted.history.scene.objects[0]).toMatchObject({ id: joined.id, dx: 0, dy: 0 })
    expect(undo(deleted.history).scene).toEqual(history.scene)
  })

  it('分支吸附到已解析的主线，随上游移动；删除主线保留分支及世界坐标', () => {
    const branch: LineObject = { ...arrow, id: 'branch', x: 195, y: 175, dx: 0, dy: 100,
      startBinding: { targetId: arrow.id, kind: 'path', segment: 0, t: .5 } }
    const { endBinding: _, ...leaf } = branch
    const before = createHistory({ id: 'chain', objects: [leaf, arrow, a, b] })
    expect(resolveEndpoints(leaf, before.scene.objects).start).toEqual({ x: 195, y: 107.5 })
    const next = submit(before, [{ type: 'update', id: a.id, changes: { y: 160 } }])
    expect(next.ok).toBe(true)
    expect(resolveEndpoints(leaf, next.history.scene.objects).start).toEqual({ x: 195, y: 137.5 })
    const deleted = submit(next.history, [{ type: 'delete', id: arrow.id }])
    expect(deleted.ok).toBe(true)
    const kept = deleted.history.scene.objects[0] as LineObject
    expect(kept).not.toHaveProperty('startBinding')
    expect(resolveEndpoints(kept, deleted.history.scene.objects).start).toEqual({ x: 195, y: 137.5 })
    expect(undo(deleted.history).scene).toBe(next.history.scene)
    const copied = offsetCopies(captureSelection(before.scene.objects, ['a', 'b', arrow.id, leaf.id]), id => `${id}-copy`, { x: 24, y: 24 })
    const branchCopy = copied[0] as LineObject
    expect(branchCopy.startBinding).toMatchObject({ targetId: `${arrow.id}-copy`, segment: 0 })
    expect(resolveEndpoints(branchCopy, copied).start).toEqual({ x: 219, y: 131.5 })
    const [branchOnly] = offsetCopies(captureSelection(before.scene.objects, [leaf.id]), id => `${id}-alone`, { x: 24, y: 24 }) as LineObject[]
    expect(branchOnly).not.toHaveProperty('startBinding')
    expect(resolveEndpoints(branchOnly, [])).toEqual(resolveEndpoints(branchCopy, copied))
  })

  it('互接、自接及不存在的路径段拒绝提交', () => {
    const path = { targetId: arrow.id, kind: 'path', segment: 0, t: .5 } as const
    const branch: LineObject = { ...arrow, id: 'branch', startBinding: path }
    const before = createHistory({ ...scene, objects: [...scene.objects, branch] })
    for (const startBinding of [{ ...path, targetId: branch.id }, path, { ...path, segment: 42 }]) {
      const result = submit(before, [{ type: 'update', id: arrow.id, changes: { startBinding } }])
      expect(result.ok).toBe(false)
      expect(result.history).toBe(before)
    }
  })

  it('缩短主线令分支失效时，不允许通过复制并删除原分支绕过验证', () => {
    const path = { kind: 'polyline', start: { x: -50, y: 0 }, segments: [
      { id: 0, to: { x: 0, y: 0 } }, { id: 1, to: { x: 0, y: 100 } },
    ] } as const
    const main: LineObject = { ...arrow, path }
    const leaf: LineObject = { ...arrow, id: 'leaf', startBinding: { targetId: main.id, kind: 'path', segment: 1, t: .5 } }
    const history = createHistory({ id: 'chain-invalid', objects: [a, b, main, leaf] })
    const result = submit(history, [{ type: 'update', id: main.id, changes: { path: { ...path, segments: path.segments.slice(0, 1) } } },
      { type: 'duplicate', id: leaf.id, newId: 'copy' }, { type: 'delete', id: leaf.id }])
    expect(result).toMatchObject({ ok: false, code: 'invalid-connection', index: 0 })
    expect(result.history).toBe(history)
  })

  it('隐藏的零线宽路径不抢吸附，既有绑定仍然可解析', () => {
    const main = { ...arrow, strokeWidth: 0 }
    const leaf: LineObject = { ...arrow, id: 'leaf', startBinding: { targetId: main.id, kind: 'path', segment: 0, t: .5 } }
    expect(snapToBoundary([a, b, main], { x: 195, y: 107.5 }, 2)).toBeUndefined()
    expect(resolveEndpoints(leaf, [a, b, main]).start).toEqual({ x: 195, y: 107.5 })
  })

  it('命中旋转笔迹和文字外框而不是开放路径的包围盒', () => {
    const ink = { id: 'ink', type: 'stroke', x: 150, y: 100, rotation: 90, stroke: '#355985', strokeWidth: 4,
      points: [{ x: -60, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 40 }] } as const
    const label = { id: 'text', type: 'text', x: 350, y: 250, rotation: 0, text: '测试',
      fontSize: 30, fontFamily: 'sans-serif', color: '#355985', anchorSize: { width: 60, height: 34 } } as const
    expect(snapToBoundary([ink], { x: 151, y: 60 }, 2)?.binding).toMatchObject({ targetId: 'ink', kind: 'path', segment: 0 })
    expect(snapToBoundary([ink], { x: 110, y: 40 }, 2)).toBeUndefined()
    expect(snapToBoundary([label], { x: 380, y: 255 }, 2)?.binding).toMatchObject({ targetId: 'text', kind: 'edge', edge: 1 })
  })
})
