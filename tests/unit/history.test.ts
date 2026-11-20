import { describe, expect, it } from 'vitest'
import { createHistory, redo, submit, undo } from '../../src/core/history'
import { rectangle, text } from './fixtures/scenes'

const initial = () => createHistory({ id: 'personal', objects: [text(), rectangle(), rectangle('rect-c')] })

describe('画布历史', () => {
  it('一批修改只发布一次，撤销与重做都整体执行', () => {
    const history = initial()
    const changed = submit(history, [
      { type: 'update', id: 'text-a', changes: { text: '改字' } },
      { type: 'update', id: 'rect-b', changes: { x: 200 } },
    ], { sceneId: 'personal', writableIds: ['text-a', 'rect-b'] })
    if (!changed.ok) throw new Error(changed.code)
    expect(changed.history.past).toEqual([history.scene])
    expect(changed.history.scene.objects).toEqual([
      { ...text(), text: '改字' }, { ...rectangle(), x: 200 }, rectangle('rect-c'),
    ])

    const undone = undo(changed.history)
    expect(undone.scene).toEqual(history.scene)
    expect(undone.future).toEqual([changed.history.scene])
    expect(undo(undone)).toBe(undone)
    expect(redo(undone)).toEqual(changed.history)
    expect(redo(changed.history)).toBe(changed.history)
  })

  it('失败、空批次和抵消后的修改不写入历史，也不清除重做', () => {
    const first = submit(initial(), [{ type: 'update', id: 'rect-b', changes: { x: 125 } }])
    if (!first.ok) throw new Error(first.code)
    const undone = undo(first.history)

    expect(submit(undone, [])).toEqual({ ok: true, history: undone })
    const canceled = submit(undone, [
      { type: 'update', id: 'rect-b', changes: { x: 180 } },
      { type: 'update', id: 'rect-b', changes: { x: 120 } },
    ])
    if (!canceled.ok) throw new Error(canceled.code)
    expect(canceled.history).toBe(undone)
    expect(submit(undone, [
      { type: 'update', id: 'rect-b', changes: { x: 180 } },
      { type: 'update', id: 'unknown', changes: { y: 99 } },
    ])).toEqual({ ok: false, code: 'unknown-object', index: 1, history: undone })
    expect(redo(undone)).toEqual(first.history)
  })

  it('撤销后的新编辑清除重做，只能重做新分支', () => {
    const first = submit(initial(), [{ type: 'update', id: 'rect-b', changes: { x: 125 } }])
    if (!first.ok) throw new Error(first.code)
    const other = submit(undo(first.history), [{ type: 'update', id: 'rect-b', changes: { x: 200 } }])
    if (!other.ok) throw new Error(other.code)
    expect(other.history.future).toEqual([])
    expect(redo(other.history)).toBe(other.history)
    expect(redo(undo(other.history))).toEqual(other.history)
  })

  it('历史接收场景快照，不保留调用方传入的数据引用', () => {
    const external = { ...rectangle() }
    const objects = [external]
    const history = createHistory({ id: 'personal', objects })
    external.width = 500
    objects.push({ ...rectangle('rect-extra') })
    expect(history.scene.objects).toEqual([rectangle()])
  })
})
