import { describe, expect, it } from 'vitest'
import { applyCommands, type SceneCommand } from '../../src/core/commands'
import { createScene } from '../../src/core/scene'
import { rectangle, text } from './fixtures/scenes'

describe('画布命令', () => {
  it('按顺序创建矩形和文字，并按稳定 ID 更新几何和文本', () => {
    const scene = createScene('personal')
    const rect = rectangle()
    const label = text()
    expect(scene).toEqual({ id: 'personal', objects: [] })

    const created = applyCommands(scene, [
      { type: 'create', object: rect }, { type: 'create', object: label },
    ])
    if (!created.ok) throw new Error(created.code)
    expect(created.scene.objects).toEqual([rect, label])

    const edited = applyCommands(created.scene, [
      { type: 'update', id: rect.id, changes: { x: -4, width: 91, rotation: 24 } },
      { type: 'update', id: label.id, changes: { text: '测试后的中文' } },
    ])
    expect(edited).toEqual({ ok: true, scene: { id: 'personal', objects: [
      { ...rect, x: -4, width: 91, rotation: 24 }, { ...label, text: '测试后的中文' },
    ] } })
    expect(created.scene.objects).toEqual([rect, label])
    expect(scene.objects).toEqual([])
  })

  it('创建时复制对象数据，调用方事后改动不会污染场景', () => {
    const input = { ...rectangle() }
    const result = applyCommands(createScene('personal'), [{ type: 'create', object: input }])
    if (!result.ok) throw new Error(result.code)
    input.x = 900
    expect(result.scene.objects[0].x).toBe(120)
  })

  it('拒绝空的画布 ID', () => {
    expect(() => createScene('  ')).toThrow()
  })

  it.each([
    [{ type: 'create', object: rectangle() }, 'duplicate-object'],
    [{ type: 'create', object: { ...text(), id: '' } }, 'invalid-object'],
    [{ type: 'update', id: 'rect-b', changes: { x: Number.NaN } }, 'invalid-object'],
    [{ type: 'update', id: 'rect-b', changes: { rotation: Infinity } }, 'invalid-object'],
    [{ type: 'update', id: 'rect-b', changes: { width: 0 } }, 'invalid-object'],
    [{ type: 'update', id: 'rect-b', changes: { height: -1 } }, 'invalid-object'],
    [{ type: 'update', id: 'rect-b', changes: { strokeWidth: -2 } }, 'invalid-object'],
    [{ type: 'update', id: 'rect-b', changes: { text: '不是矩形属性' } }, 'invalid-object'],
    [{ type: 'update', id: 'rect-b', changes: { id: '另一个 ID' } }, 'invalid-object'],
    [{ type: 'update', id: 'rect-b', changes: { type: 'text' } }, 'invalid-object'],
  ] as const)('拒绝无效命令 %#，保留原场景', (command, code) => {
    const rect = rectangle()
    const scene = { id: 'personal', objects: [rect] }
    expect(applyCommands(scene, [command as SceneCommand])).toMatchObject({ ok: false, code })
    expect(scene.objects).toEqual([rect])
  })

  const scopedScene = () => ({ id: 'personal', objects: [text(), rectangle(), rectangle('rect-c')] })
  const scope = { sceneId: 'personal', writableIds: ['text-a', 'rect-b', 'missing'] }

  it('受限批次只修改指定对象，未授权对象和顺序保持不变', () => {
    const scene = scopedScene()
    const result = applyCommands(scene, [
      { type: 'update', id: 'text-a', changes: { text: '限定改动' } },
      { type: 'update', id: 'rect-b', changes: { x: 180 } },
    ], scope)

    expect(result).toEqual({ ok: true, scene: { id: 'personal', objects: [
      { ...text(), text: '限定改动' }, { ...rectangle(), x: 180 }, rectangle('rect-c'),
    ] } })
  })

  it.each([
    [{ type: 'update', id: 'rect-c', changes: { y: 100 } }, 'out-of-scope'],
    [{ type: 'update', id: 'missing', changes: { y: 100 } }, 'unknown-object'],
    [{ type: 'update', id: 'rect-b', changes: { width: 0 } }, 'invalid-object'],
    [{ type: 'create', object: rectangle('new') }, 'out-of-scope'],
    [{ type: 'replace', id: 'rect-b', changes: { x: 30 } }, 'invalid-command'],
  ] as const)('后续命令无效时放弃前面有效的修改 %#', (invalid, code) => {
    const scene = scopedScene()
    const result = applyCommands(scene, [
      { type: 'update', id: 'text-a', changes: { text: '不能生效' } }, invalid as SceneCommand,
    ], scope)

    expect(result).toEqual({ ok: false, code, index: 1 })
    expect(scene).toEqual(scopedScene())
  })

  it('同一对象 ID 不能通过其他画布的授权修改', () => {
    const result = applyCommands(scopedScene(), [{ type: 'update', id: 'rect-b', changes: { x: 32 } }], {
      ...scope, sceneId: 'other-scene',
    })
    expect(result).toEqual({ ok: false, code: 'out-of-scope', index: 0 })
  })

  it('受限入口只有明确授权时才允许新建', () => {
    const result = applyCommands(scopedScene(), [{ type: 'create', object: rectangle('new') }], {
      ...scope, allowCreate: true,
    })
    expect(result).toMatchObject({ ok: true, scene: { objects: [...scopedScene().objects, rectangle('new')] } })
  })
})
