import { describe, expect, it } from 'vitest'
import { decodeProject, encodeProject } from '../../src/project/projectFile'
import { rectangle, text } from './fixtures/scenes'

const scene = { id: 'personal', objects: [{ ...rectangle(), rotation: 31 }, text(), rectangle('third')] }
const envelope = (nextScene: unknown) => JSON.stringify({ format: 'document-vector-canvas', version: 1, scene: nextScene })

describe('Personal Mode 项目文件', () => {
  it('完整往返保留稳定 ID、绘制顺序、几何、样式和多行中文', () => {
    const encoded = encodeProject(scene)
    expect(JSON.parse(encoded)).toEqual({ format: 'document-vector-canvas', version: 1, scene })
    expect(decodeProject(encoded)).toEqual({ ok: true, scene })
  })

  it('不写入画布视口、预览、历史等会话字段', () => {
    const enriched = { ...scene, viewport: { zoom: 2 }, history: [{}], selectedIds: ['rect-b'] }
    expect(JSON.parse(encodeProject(enriched))).toEqual({ format: 'document-vector-canvas', version: 1, scene })
  })

  it.each([
    ['{不完整', 'invalid-json'],
    ['null', 'unsupported-format'],
    [JSON.stringify({ format: 'fabric-spike', version: 1, scene }), 'unsupported-format'],
    [JSON.stringify({ format: 'document-vector-canvas', version: 42, scene }), 'unsupported-version'],
    [envelope({ ...scene, id: '' }), 'invalid-scene'],
    [envelope({ ...scene, objects: null }), 'invalid-scene'],
    [envelope({ ...scene, objects: [rectangle(), { ...text(), id: 'rect-b' }] }), 'duplicate-object'],
    [envelope({ ...scene, objects: [{ ...rectangle(), type: 'ellipse' }] }), 'invalid-object'],
    [envelope({ ...scene, objects: [{ ...rectangle(), width: 0 }] }), 'invalid-object'],
    [envelope({ ...scene, objects: [{ ...rectangle(), y: '100' }] }), 'invalid-object'],
    [envelope({ ...scene, objects: [{ ...rectangle(), x: null }] }).replace('"x":null', '"x":1e999'), 'invalid-object'],
    [envelope({ ...scene, objects: [{ ...rectangle(), unknown: true }] }), 'invalid-object'],
    [envelope({ ...scene, objects: [{ ...text(), text: 123 }] }), 'invalid-object'],
  ] as const)('非法项目文件 %# 返回明确错误', (source, code) => {
    expect(decodeProject(source)).toMatchObject({ ok: false, code, message: expect.stringMatching(/\S/) })
  })
})
