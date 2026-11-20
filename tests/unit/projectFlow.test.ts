import { describe, expect, it } from 'vitest'
import { redo, submit, undo, type SceneHistory } from '../../src/core/history'
import { encodeProject } from '../../src/project/projectFile'
import { createProjectSession, isProjectDirty, markProjectSaved, openProject } from '../../src/project/projectSession'
import { rectangle, text } from './fixtures/scenes'

function created(history: SceneHistory): SceneHistory {
  const result = submit(history, [
    { type: 'create', object: text() },
    { type: 'create', object: rectangle() },
    { type: 'create', object: rectangle('rect-c') },
  ])
  if (!result.ok) throw new Error(result.code)
  return result.history
}

describe('不启动页面的项目闭环', () => {
  it('创建、定向修改、撤销重做、保存、在新会话重新打开后继续编辑', () => {
    const blank = createProjectSession('personal')
    expect(isProjectDirty(blank)).toBe(false)
    const made = created(blank.history)
    const scope = { sceneId: 'personal', writableIds: ['text-a', 'rect-b'] }
    const edited = submit(made, [
      { type: 'update', id: 'text-a', changes: { text: '这是新文本 & 第二行\n再编辑' } },
      { type: 'update', id: 'rect-b', changes: { x: 173, width: 89 } },
    ], scope)
    if (!edited.ok) throw new Error(edited.code)
    expect(edited.history.scene.objects[2]).toEqual(rectangle('rect-c'))
    expect(undo(edited.history)).toEqual({ ...made, future: [edited.history.scene] })
    expect(redo(undo(edited.history))).toEqual(edited.history)
    const rejected = submit(edited.history, [
      { type: 'update', id: 'text-a', changes: { text: '不得生效' } },
      { type: 'update', id: 'rect-c', changes: { y: 143 } },
    ], scope)
    expect(rejected).toEqual({ ok: false, code: 'out-of-scope', index: 1, history: edited.history })

    const active = { ...blank, history: edited.history }
    expect(isProjectDirty(active)).toBe(true)
    const saved = encodeProject(active.history.scene)
    expect(isProjectDirty(markProjectSaved(active))).toBe(false)
    const reopened = openProject(createProjectSession('new-session'), { status: 'read', source: saved })
    if (reopened.status !== 'opened') throw new Error('项目没有打开')
    expect(reopened.session.history.scene).toEqual(edited.history.scene)
    expect(reopened.session.history.past).toEqual([])
    expect(reopened.session.history.future).toEqual([])
    expect(isProjectDirty(reopened.session)).toBe(false)

    const changed = submit(reopened.session.history, [{ type: 'update', id: 'text-a', changes: { text: '重开后可编辑' } }])
    if (!changed.ok) throw new Error(changed.code)
    expect(changed.history.scene.objects[0]).toMatchObject({ id: 'text-a', text: '重开后可编辑' })
    expect(isProjectDirty({ ...reopened.session, history: changed.history })).toBe(true)
  })

  it('取消选择、取消丢弃、读取失败和解码失败保留画布及完整历史', () => {
    const blank = createProjectSession('personal')
    const earlier = created(blank.history)
    const edited = submit(earlier, [{ type: 'update', id: 'rect-b', changes: { x: 125 } }])
    if (!edited.ok) throw new Error(edited.code)
    const unsaved = { ...blank, history: undo(edited.history) }
    const valid = encodeProject(edited.history.scene)

    for (const request of [{ status: 'cancelled' }, { status: 'read-error' }, { status: 'read', source: '{' }] as const) {
      expect(openProject(unsaved, request).session).toBe(unsaved)
    }
    expect(openProject(unsaved, { status: 'read-error' })).toMatchObject({ status: 'error', code: 'read-error' })
    expect(openProject(unsaved, { status: 'read', source: '{' })).toMatchObject({ status: 'error', code: 'invalid-json' })
    expect(openProject(unsaved, { status: 'read', source: valid })).toEqual({ status: 'needs-confirmation', session: unsaved })
    const opened = openProject(unsaved, { status: 'read', source: valid, discardChanges: true })
    expect(opened).toMatchObject({ status: 'opened', session: { history: { scene: edited.history.scene, past: [], future: [] } } })
  })

  it('撤销回已保存的内容时不再标为未保存', () => {
    const blank = createProjectSession('personal')
    const saved = markProjectSaved({ ...blank, history: created(blank.history) })
    const edited = submit(saved.history, [{ type: 'update', id: 'rect-b', changes: { x: 126 } }])
    if (!edited.ok) throw new Error(edited.code)
    expect(isProjectDirty({ ...saved, history: edited.history })).toBe(true)
    expect(isProjectDirty({ ...saved, history: undo(edited.history) })).toBe(false)
  })
})
