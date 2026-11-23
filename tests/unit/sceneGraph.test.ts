import { describe, expect, it } from 'vitest'
import { createHistory, redo, undo } from '../../src/core/history'
import { createLocalEditGrant, submitLocalEdit, type LocalEditGrant } from '../../src/core/localSceneAccess'
import { listScenePages, readSceneGraph } from '../../src/core/sceneGraph'
import type { CanvasScene } from '../../src/core/scene'
import { graphFixture } from '../fixtures/documents/sceneGraphFixture'

const first = { projectId: 'e8-demo', pageId: 'p1' }, second = { projectId: 'e8-demo', pageId: 'p2' }
const move = { type: 'update', id: 'process', changes: { x: 128, y: 161 } } as const

describe('E8 · 按页图谱读取', () => {
  it('同 ID 不串页；读取显式箭头与分支，区分无向线和视觉相交；不返回底稿字节', () => {
    const project = graphFixture()
    expect(listScenePages(project)).toEqual([{ ...first, number: 1, size: { width: 200, height: 300 }, kind: 'pdf' },
      { ...second, number: 2, size: { width: 200, height: 320 }, kind: 'pdf' }])
    expect(readSceneGraph(project, first)?.objects[0].record.x).toBe(85)
    const graph = readSceneGraph(project, second)!
    expect(graph.objects.find(({ record }) => record.id === 'process')?.record.x).toBe(100)
    expect(graph.source).toEqual({ kind: 'pdf', locked: true, text: { status: 'available', provenance: 'stored', value: 'SECOND BASE TEXT' } })
    expect(graph.relations).toEqual([
      { connectorId: 'incoming', targetId: 'input', end: 'start', direction: 'out', binding: { targetId: 'input', kind: 'edge', edge: 2, t: .5 } },
      { connectorId: 'incoming', targetId: 'process', end: 'end', direction: 'in', binding: { targetId: 'process', kind: 'edge', edge: 0, t: .5 } },
      { connectorId: 'main', targetId: 'process', end: 'start', direction: 'out', binding: { targetId: 'process', kind: 'edge', edge: 2, t: .5 } },
      { connectorId: 'main', targetId: 'output', end: 'end', direction: 'in', binding: { targetId: 'output', kind: 'edge', edge: 0, t: .5 } },
      { connectorId: 'branch', targetId: 'main', end: 'start', direction: 'undirected', binding: { targetId: 'main', kind: 'path', segment: 0, t: .5 } },
    ])
    expect(graph.connectors.map(({ id, path, directed }) => [id, path, directed])).toEqual([
      ['incoming', 'straight', true], ['main', 'polyline', true], ['branch', 'curve', false], ['crossing', 'straight', false],
    ])
    expect(graph.connectors.find(c => c.id === 'branch')?.endpoints.start).toEqual({ x: 100, y: 181 })
    expect(graph.objects.find(({ record }) => record.id === 'draft')?.placement).toBe('outside')
    expect(graph.objects.find(({ record }) => record.id === 'part')?.placement).toBe('boundary')
    expect(JSON.stringify(graph)).not.toContain(project.document!.source.kind === 'pdf' ? project.document!.source.data : 'bad-test')
    expect(readSceneGraph(project, { ...second, pageId: null })).toBeUndefined()
    expect(readSceneGraph(project, { ...second, projectId: 'other' })).toBeUndefined()
    const mutable = structuredClone(graph)
    expect(mutable).toEqual(graph)
    expect(graph.objects[0].record).not.toBe(project.document!.pages[1].scene.objects[0])
  })

  it('无文字层明确返回不可读，不猜 OCR；旧单画布没有固定页边', () => {
    const project = graphFixture(), doc = project.document!
    const scan: CanvasScene = { ...project, document: { ...doc, pages: [{ ...doc.pages[0], text: null }] } }
    expect(readSceneGraph(scan, first)?.source).toEqual({ kind: 'pdf', locked: true, text: { status: 'unavailable' } })
    const single = { id: 'single', objects: doc.pages[0].scene.objects }
    expect(readSceneGraph(single, { projectId: 'single', pageId: null })).toMatchObject({ source: null, objects: [{ placement: 'unbounded' }] })
  })

  it('图谱返回分离快照，原生图片只有资源描述而没有字节或 OCR', () => {
    const project = graphFixture()
    const object = { type: 'image', id: 'table', assetId: 'asset', x: 100, y: 150, rotation: 0, width: 76, height: 48 } as const
    const scene = { id: 'table-demo', objects: [object], images: [{ id: 'asset', mime: 'image/png', width: 76, height: 48,
      data: 'NOT_IN_GRAPH' }] } as const
    const graph = readSceneGraph(scene, { projectId: 'table-demo', pageId: null })!
    expect(graph.images).toEqual([{ id: 'asset', mime: 'image/png', width: 76, height: 48 }])
    expect(JSON.stringify(graph)).not.toContain('NOT_IN_GRAPH')
    const detached = readSceneGraph(project, second)!
    Reflect.set(detached.objects[1].record, 'x', 9999)
    Reflect.set(detached.relations[0].binding, 'targetId', 'draft')
    expect(readSceneGraph(project, second)?.objects[1].record.x).toBe(100)
    expect(readSceneGraph(project, second)?.relations[0].binding.targetId).toBe('input')
  })

  it('折线箭头只在末端扩到箭翼，不把页外箭杆或页内起点误报为跨边', () => {
    const project = graphFixture(), doc = project.document!, page = doc.pages[0]
    const arrow = (id: string, sign: number) => ({ type: 'arrow', id, x: 0, y: 70, dx: sign * 110, dy: 0, strokeWidth: 2,
      stroke: '#224488', rotation: 0, path: { kind: 'polyline', start: { x: sign * 10, y: 0 },
        segments: [{ id: 0, to: { x: sign * 80, y: 0 } }, { id: 1, to: { x: sign * 120, y: 0 } }] } } as const)
    const graph = readSceneGraph({ ...project, document: { ...doc, pages: [{ ...page, scene: { ...page.scene,
      objects: [arrow('inside', 1), arrow('outside', -1)] } }] } }, first)
    expect(graph?.objects.map(object => object.placement)).toEqual(['inside', 'outside'])
  })
})

describe('E8 · 按页授权批次', () => {
  it('只写第 2 页节点；绑定线（含间接分支）真实端点随动但资料未被改写，一次撤销恢复', () => {
    const history = createHistory(graphFixture())
    const grant = createLocalEditGrant(history, second, ['process'])!
    const result = submitLocalEdit(history, grant, { ...second, commands: [move] })
    expect(result).toMatchObject({ ok: true, writtenIds: ['process'], derivedConnectorIds: ['incoming', 'main', 'branch'] })
    expect(result.history.scene.document!.source).toBe(history.scene.document!.source)
    expect(result.history.scene.document!.pages[0]).toBe(history.scene.document!.pages[0])
    const graph = readSceneGraph(result.history.scene, second)!
    expect(graph.connectors.find(c => c.id === 'main')?.endpoints.start).toEqual({ x: 128, y: 177 })
    expect(graph.connectors.find(c => c.id === 'branch')?.endpoints.start).toEqual({ x: 114, y: 191.5 })
    expect(undo(result.history).scene).toBe(history.scene)
    expect(redo(undo(result.history)).scene).toBe(result.history.scene)
  })

  it('拒绝跨页、底稿字段、未知目标、非法锚点和未授权的隐式解绑；失败保留重做', () => {
    const initial = createHistory(graphFixture())
    const moved = submitLocalEdit(initial, createLocalEditGrant(initial, second, ['process'])!, { ...second, commands: [move] })
    const history = undo(moved.history)
    const grant = createLocalEditGrant(history, second, ['process', 'main'])!
    for (const [request, code, index] of [
      [{ ...first, commands: [move] }, 'out-of-scope', 0],
      [{ ...second, commands: [move], source: {} }, 'invalid-command', 0],
      [{ ...second, commands: [move, { type: 'update', id: 'draft', changes: { x: 90 } }] }, 'out-of-scope', 1],
      [{ ...second, commands: [move, { type: 'update', id: 'missing', changes: { x: 90 } }] }, 'unknown-object', 1],
      [{ ...second, commands: [move, { type: 'update', id: 'main', changes: { startBinding: { targetId: 'process', kind: 'edge', edge: 9, t: .5 } } }] }, 'invalid-connection', 1],
      [{ ...second, commands: [move, { type: 'delete', id: 'process' }] }, 'out-of-scope', 1],
    ] as const) {
      const result = submitLocalEdit(history, grant, request)
      expect(result).toMatchObject({ ok: false, code, index })
      expect(result.history).toBe(history)
    }
    expect(redo(history).scene).toBe(moved.history.scene)
    expect(submitLocalEdit(moved.history, grant, { ...second, commands: [move] })).toMatchObject({ ok: false, code: 'stale-scope' })
  })

  it('授权真实写入的对象才允许删除与解绑；旧授权不能用于重新打开的同 ID 项目', () => {
    const history = createHistory(graphFixture())
    const grant = createLocalEditGrant(history, second, ['process', 'incoming', 'main'])!
    expect(createLocalEditGrant(history, second, ['bottom-layer'])).toBeUndefined()
    expect(submitLocalEdit(history, {} as LocalEditGrant, { ...second, commands: [move] })).toMatchObject({ ok: false, code: 'out-of-scope' })
    expect(submitLocalEdit(createHistory(history.scene), grant, { ...second, commands: [move] })).toMatchObject({ ok: false, code: 'stale-scope' })
    const update = submitLocalEdit(history, grant, { ...second, commands: [move, { type: 'update', id: 'main', changes: { stroke: '#ff0000' } }] })
    expect(update).toMatchObject({ ok: true, writtenIds: ['process', 'main'], derivedConnectorIds: ['incoming', 'branch'] })
    expect(update.history.past).toHaveLength(1)
    const removed = submitLocalEdit(history, grant, { ...second, commands: [{ type: 'delete', id: 'process' }] })
    expect(removed).toMatchObject({ ok: true, writtenIds: ['process', 'incoming', 'main'], derivedConnectorIds: [] })
    expect(readSceneGraph(removed.history.scene, second)?.relations.some(link => link.targetId === 'process')).toBe(false)
    expect(undo(removed.history).scene).toBe(history.scene)
  })

  it('本地无字体实测时，拒绝改动已绑定文字的排版尺寸，仍允许移动节点', () => {
    const project = graphFixture(), doc = project.document!, page = doc.pages[1]
    const objects = page.scene.objects.map(object => object.id === 'process' ? ({ type: 'text', id: 'process', x: 100, y: 140,
      rotation: 0, fontFamily: 'Arial', fontSize: 18, text: '处理', color: '#333333', anchorSize: { width: 36, height: 32 } } as const) : object)
    const history = createHistory({ ...project, document: { ...doc, pages: [doc.pages[0], { ...page, scene: { ...page.scene, objects } }] } })
    const grant = createLocalEditGrant(history, second, ['process'])!
    const result = submitLocalEdit(history, grant, { ...second, commands: [move, { type: 'update', id: 'process', changes: { text: 'WWWWWWWWWWWW' } }] })
    expect(result).toMatchObject({ ok: false, code: 'text-layout-required', index: 1 })
    expect(result.history).toBe(history)
    expect(submitLocalEdit(history, grant, { ...second, commands: [move] })).toMatchObject({ ok: true, writtenIds: ['process'] })
  })
})
