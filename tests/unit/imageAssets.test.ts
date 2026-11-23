import { describe, expect, it } from 'vitest'
import { createHistory, redo, submit, undo } from '../../src/core/history'
import { imageAssetsForObjects, inspectImage, maxImageBytes } from '../../src/core/imageAssets'
import { decodeProject, encodeProject } from '../../src/project/projectFile'
import { tinyPng } from '../fixtures/image-samples'

const asset = { id: 'local', mime: 'image/png', width: 1, height: 1, data: tinyPng } as const
const image = { id: 'figure', type: 'image', assetId: asset.id, x: 30, y: 50, width: 100, height: 100, rotation: 0 } as const

describe('项目内嵌图片', () => {
  it('依据实际字节读取类型和尺寸，拒绝伪签名和超大像素', () => {
    const bytes = Uint8Array.from(Buffer.from(tinyPng, 'base64'))
    expect(inspectImage(bytes)).toEqual({ mime: 'image/png', width: 1, height: 1 })
    expect(inspectImage(bytes.slice(0, 20))).toBeUndefined()
    expect(inspectImage(Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0, 3, 0))).toBeUndefined()
    new DataView(bytes.buffer).setUint32(16, 16_000_001)
    expect(inspectImage(bytes)).toBeUndefined()
  })

  it('同一份资源随图元保存，缺失、外链、错误尺寸、旧格式均拒绝', () => {
    const scene = { id: 'p', objects: [image, { ...image, id: 'copy' }], images: [asset] }
    expect(decodeProject(encodeProject(scene))).toEqual({ ok: true, scene })
    expect(decodeProject(encodeProject({ ...scene, images: [] }))).toMatchObject({ ok: false, code: 'invalid-image' })
    for (const changed of [{ ...asset, data: 'https://example.test/photo.png' }, { ...asset, width: 4 }, { ...asset, mime: 'image/jpeg' }] as const) {
      expect(decodeProject(encodeProject({ ...scene, images: [changed] }))).toMatchObject({ ok: false, code: 'invalid-image' })
    }
    expect(decodeProject(encodeProject(scene).replace('"version": 2', '"version": 1'))).toMatchObject({ ok: false })
  })

  it('新增资源和图元一起撤销，复制共享资源，删除最后一个实例后可撤销恢复', () => {
    const initial = createHistory({ id: 'p', objects: [] })
    expect(submit(initial, [{ type: 'create', object: image }])).toMatchObject({ ok: false, code: 'invalid-image', history: initial })
    const imported = submit(initial, [{ type: 'add-image-asset', asset }, { type: 'create', object: image }])
    expect(imported.ok).toBe(true)
    expect(imported.history.past).toHaveLength(1)
    const importedAsset = imported.history.scene.images![0]
    expect(redo(undo(imported.history)).scene.images![0]).toBe(importedAsset)
    const copied = submit(imported.history, [{ type: 'duplicate', id: image.id, newId: 'copy' }])
    const reduced = submit(copied.history, [{ type: 'delete', id: image.id }])
    expect(reduced.history.scene.images).toHaveLength(1)
    expect(reduced.history.scene.images![0]).toBe(importedAsset)
    const removed = submit(reduced.history, [{ type: 'delete', id: 'copy' }])
    expect(removed.history.scene.images).toBeUndefined()
    expect(undo(removed.history).scene.images![0]).toBe(importedAsset)
  })

  it('项目按实际引用的原始字节累计，副本不会把同一资源算第二次', () => {
    const payload = Buffer.alloc(maxImageBytes).toString('base64')
    const assets = Array.from({ length: 5 }, (_, i) => ({ ...asset, id: `${i}`, data: payload }))
    const objects = assets.map(({ id }) => ({ ...image, id: `figure-${id}`, assetId: id }))
    const atLimit = [...objects.slice(0, 4), { ...objects[0], id: 'copy' }]
    expect(imageAssetsForObjects(atLimit, assets)?.map(({ id }) => id)).toEqual(['0', '1', '2', '3'])
    expect(imageAssetsForObjects(objects, assets)).toBeUndefined()
  })

  it('拒绝只有图片头的项目、以及随后删除的坏图片引用', () => {
    const initial = createHistory({ id: 'p', objects: [] })
    const truncated = { ...asset, data: Buffer.from(tinyPng, 'base64').subarray(0, 33).toString('base64') }
    const invalid = submit(initial, [{ type: 'add-image-asset', asset: truncated }, { type: 'create', object: image }])
    expect(invalid).toMatchObject({ ok: false, code: 'invalid-image', index: 0, history: initial })
    expect(decodeProject(encodeProject({ id: 'p', objects: [image], images: [truncated] }))).toMatchObject({ ok: false, code: 'invalid-image' })
    expect(submit(initial, [{ type: 'create', object: image }, { type: 'delete', id: image.id }])).toMatchObject({ ok: false, code: 'invalid-image', index: 0, history: initial })
  })
})
