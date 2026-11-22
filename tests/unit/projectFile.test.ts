import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodeProject, encodeProject } from '../../src/project/projectFile'
import { rectangle, text } from './fixtures/scenes'

const scene = { id: 'personal', objects: [{ ...rectangle(), rotation: 31 }, text(), rectangle('third')] }
const envelope = (nextScene: unknown) => JSON.stringify({ format: 'document-vector-canvas', version: 1, scene: nextScene })
const c3Download = readFileSync(new URL('../fixtures/projects/personal-v1.json', import.meta.url), 'utf8')

describe('Personal Mode 项目文件', () => {
  it('完整往返保留稳定 ID、绘制顺序、几何、样式和多行中文', () => {
    const encoded = encodeProject(scene)
    expect(JSON.parse(encoded)).toEqual({ format: 'document-vector-canvas', version: 2, scene })
    expect(decodeProject(encoded)).toEqual({ ok: true, scene })
  })

  it('不写入画布视口、预览、历史等会话字段', () => {
    const enriched = { ...scene, viewport: { zoom: 2 }, history: [{}], selectedIds: ['rect-b'] }
    expect(JSON.parse(encodeProject(enriched))).toEqual({ format: 'document-vector-canvas', version: 2, scene })
  })

  it('C3 实际下载的 v1 项目无损打开，再保存时写为 v2', () => {
    const original = JSON.parse(c3Download)
    expect(original.version).toBe(1)
    const migrated = decodeProject(c3Download)
    if (!migrated.ok) throw new Error(migrated.message)
    expect(migrated.scene).toEqual(original.scene)
    expect(migrated.scene.objects[0]).toMatchObject({ type: 'rectangle', strokeStyle: 'dashed' })
    expect(migrated.scene.objects.at(-1)).toMatchObject({ type: 'text', text: '帧数与预算 & 对照\n第二行中文' })
    const next = encodeProject(migrated.scene)
    expect(JSON.parse(next)).toEqual({ ...original, version: 2 })
    expect(decodeProject(next)).toEqual(migrated)
  })

  it('新图元与既有矩形、文字共用项目文件，保留方向和局部笔迹点', () => {
    const style = { x: 90, y: 120, rotation: 0, stroke: '#355985', strokeWidth: 3 }
    const source = { id: 'drawing', objects: [rectangle(), text(),
      { ...rectangle('oval'), type: 'ellipse' },
      { ...style, id: 'line', type: 'line', dx: 0, dy: 30 },
      { ...style, id: 'arrow', type: 'arrow', dx: -48, dy: 10 },
      { ...style, id: 'stroke', type: 'stroke', points: [{ x: -5, y: 2 }, { x: 5, y: -2 }] },
    ] }
    expect(decodeProject(envelope(source))).toEqual({ ok: true, scene: source })
  })

  it.each([
    ['{不完整', 'invalid-json'],
    ['null', 'unsupported-format'],
    [JSON.stringify({ format: 'fabric-spike', version: 1, scene }), 'unsupported-format'],
    [JSON.stringify({ format: 'document-vector-canvas', version: 42, scene }), 'unsupported-version'],
    [JSON.stringify({ format: 'document-vector-canvas', version: 2, scene: { ...scene, objects: [{ ...rectangle(), attachment: {} }] } }), 'invalid-object'],
    [envelope({ ...scene, id: '' }), 'invalid-scene'],
    [envelope({ ...scene, objects: null }), 'invalid-scene'],
    [envelope({ ...scene, objects: [rectangle(), { ...text(), id: 'rect-b' }] }), 'duplicate-object'],
    [envelope({ ...scene, objects: [{ ...rectangle(), type: 'unknown' }] }), 'invalid-object'],
    [envelope({ ...scene, objects: [{ id: 'arrow', type: 'arrow', x: 0, y: 0, rotation: 0, stroke: '#355985', strokeWidth: 2, dx: 0, dy: 0 }] }), 'invalid-object'],
    [envelope({ ...scene, objects: [{ id: 'stroke', type: 'stroke', x: 0, y: 0, rotation: 0, stroke: '#355985', strokeWidth: 2, points: [{ x: 0, y: 0 }, { x: 'bad', y: 1 }] }] }), 'invalid-object'],
    [envelope({ ...scene, objects: [{ ...rectangle(), width: 0 }] }), 'invalid-object'],
    [envelope({ ...scene, objects: [{ ...rectangle(), y: '100' }] }), 'invalid-object'],
    [envelope({ ...scene, objects: [{ ...rectangle(), x: null }] }).replace('"x":null', '"x":1e999'), 'invalid-object'],
    [envelope({ ...scene, objects: [{ ...rectangle(), unknown: true }] }), 'invalid-object'],
    [envelope({ ...scene, objects: [{ ...text(), text: 123 }] }), 'invalid-object'],
  ] as const)('非法项目文件 %# 返回明确错误', (source, code) => {
    expect(decodeProject(source)).toMatchObject({ ok: false, code, message: expect.stringMatching(/\S/) })
  })
})
