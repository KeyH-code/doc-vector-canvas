import { describe, expect, it } from 'vitest'
import { pageScene } from '../../src/core/document'
import { createHistory, redo, submitPage, undo } from '../../src/core/history'
import { decodeProject, encodeProject } from '../../src/project/projectFile'
import type { CanvasScene } from '../../src/core/scene'
import { pdfFixture } from '../fixtures/documents/pdfFixture'

const project: CanvasScene = { id: 'doc', objects: [], document: {
  source: { kind: 'pdf', data: pdfFixture().toString('base64') },
  pages: [{ id: 'first', width: 200, height: 300, text: null, scene: { id: 'first', objects: [] } },
    { id: 'second', width: 200, height: 320, text: null, scene: { id: 'second', objects: [] } }],
} }
const object = { type: 'rectangle', id: 'same-object', x: -40, y: 600, width: 20, height: 30, rotation: 0,
  fill: '#ffffff', stroke: '#111111', strokeWidth: 2 } as const

describe('文档画布项目', () => {
  it('两个页面分别编辑同名 ID 的对象，回退的是产生编辑的那个页面', () => {
    const original = createHistory(project)
    const first = submitPage(original, 'first', [{ type: 'create', object }])
    const second = submitPage(first.history, 'second', [{ type: 'create', object: { ...object, x: 33 } }])
    expect(first.ok && second.ok).toBe(true)
    expect(pageScene(second.history.scene, 'first').objects).toEqual([object])
    expect(pageScene(second.history.scene, 'second').objects[0].x).toBe(33)
    const reverted = undo(second.history)
    expect(pageScene(reverted.scene, 'first').objects).toEqual([object])
    expect(pageScene(reverted.scene, 'second').objects).toEqual([])
    expect(redo(reverted).scene).toBe(second.history.scene)
    expect(submitPage(second.history, 'other', [{ type: 'delete', id: object.id }])).toMatchObject({ ok: false, history: second.history })
  })

  it('v3 保存全部页面和页外元素，不在存档重复原 PDF；拒绝重复页面 ID', () => {
    const changed = submitPage(createHistory(project), 'first', [{ type: 'create', object }])
    const saved = encodeProject(changed.history.scene)
    const parsed = JSON.parse(saved)
    expect(parsed.version).toBe(3)
    expect(saved.split(pdfFixture().toString('base64'))).toHaveLength(2)
    expect(decodeProject(saved)).toEqual({ ok: true, scene: changed.history.scene })
    parsed.scene.document.pages.push(parsed.scene.document.pages[0])
    expect(decodeProject(JSON.stringify(parsed))).toMatchObject({ ok: false, code: 'invalid-document' })
  })

  it('PPTX 存档只能包含一一对应、尺寸一致的 PNG 底稿', () => {
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAE0lEQVR4nGP8//8/AwwwwVnoHABvLQMDNeDq7AAAAABJRU5ErkJggg=='
    const pages = ['first', 'second'].map(id => ({ id, width: 720, height: 540, text: null, scene: { id, objects: [] } }))
    const scene: CanvasScene = { id: 'deck', objects: [], document: { source: { kind: 'pptx', backgrounds: [png, png] }, pages } }
    const stored = encodeProject(scene)
    expect(decodeProject(stored)).toEqual({ ok: true, scene })
    const corrupted = JSON.parse(stored)
    corrupted.scene.document.source.backgrounds.pop()
    expect(decodeProject(JSON.stringify(corrupted))).toMatchObject({ ok: false, code: 'invalid-document' })
    corrupted.scene.document.source.backgrounds.push(png.slice(0, 48))
    expect(decodeProject(JSON.stringify(corrupted))).toMatchObject({ ok: false, code: 'invalid-document' })
    corrupted.scene.document.source.backgrounds[1] = png
    corrupted.scene.document.pages[1].width = 728
    expect(decodeProject(JSON.stringify(corrupted))).toMatchObject({ ok: false, code: 'invalid-document' })
  })
})
