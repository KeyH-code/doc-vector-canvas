import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { resolveEndpoints } from '../../src/core/connections'
import { maxImageBytes } from '../../src/core/imageAssets'
import { decodeProject, encodeProject } from '../../src/project/projectFile'
import { chooseLine } from './choose-line'
import { initialScenePoint } from './initial-scene-point'

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true })

async function imageFile(page: Page, mime: 'image/png' | 'image/jpeg') {
  const data = await page.evaluate(mime => {
    const canvas = document.createElement('canvas'); canvas.width = 200; canvas.height = 100
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#dd2255'; ctx.fillRect(0, 0, mime === 'image/png' ? 170 : 200, 100)
    ctx.fillStyle = '#2255dd'; ctx.fillRect(150, 24, 40, 45)
    return canvas.toDataURL(mime).split(',')[1]
  }, mime)
  return { name: mime === 'image/png' ? '素材.png' : '照片.jpg', mimeType: mime, buffer: Buffer.from(data, 'base64') }
}

async function choose(page: Page, action: string, file: { name: string; mimeType: string; buffer: Buffer }) {
  const picking = page.waitForEvent('filechooser')
  await button(page, action).click()
  await (await picking).setFiles(file)
}

async function download(page: Page, action = '保存项目') {
  const acquiring = page.waitForEvent('download')
  await button(page, action).click()
  return readFile((await (await acquiring).path())!)
}

function sceneFrom(file: Buffer) {
  const result = decodeProject(file.toString('utf8'))
  if (!result.ok) throw new Error(result.message)
  return result.scene
}

async function drag(page: Page, start: { x: number; y: number }, end: { x: number; y: number }) {
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 10 })
  await page.mouse.up()
}

function pixelAt(page: Page, x: number, y: number) {
  return page.locator('canvas[data-fabric="main"]').evaluate((canvas: HTMLCanvasElement, [worldX, worldY]) => {
    const zoom = Number(document.querySelector<HTMLSelectElement>('[aria-label="画布缩放"]')?.value)
    const cssWidth = canvas.getBoundingClientRect().width, scale = canvas.width / cssWidth
    return [...canvas.getContext('2d')!.getImageData(canvas.width / 2 + (worldX - 500) * zoom * scale,
      canvas.height / 2 + (worldY - 500 * 450 / 760) * zoom * scale, 1, 1).data]
  }, [x, y])
}

test('真实 PNG/JPEG 导入，副本共享资源，离线重开仍渲染并可导出选区', async ({ page, browser }) => {
  await page.goto('/')
  const png = await imageFile(page, 'image/png'), jpeg = await imageFile(page, 'image/jpeg')
  await choose(page, '插入图片', png)
  await expect(button(page, '选中图片 1')).toHaveAttribute('aria-pressed', 'true')
  await button(page, '复制').click(); await button(page, '粘贴').click()
  let scene = sceneFrom(await download(page))
  expect(scene.images).toHaveLength(1)
  expect(scene.objects[0]).toMatchObject({ type: 'image', assetId: scene.images![0].id })
  expect(scene.objects[1]).toMatchObject({ type: 'image', assetId: scene.images![0].id })
  await button(page, '撤销').click()
  await choose(page, '插入图片', jpeg)
  await expect(button(page, '选中图片 2')).toHaveAttribute('aria-pressed', 'true')
  const saved = await download(page)
  scene = sceneFrom(saved)
  expect(scene.images?.map(asset => [asset.mime, asset.data])).toEqual([['image/png', png.buffer.toString('base64')], ['image/jpeg', jpeg.buffer.toString('base64')]])
  const context = await browser.newContext()
  try {
    const reopened = await context.newPage()
    await reopened.goto('/')
    await expect(button(reopened, '打开项目')).toBeVisible()
    await context.setOffline(true)
    await choose(reopened, '打开项目', { name: '离线项目.json', mimeType: 'application/json', buffer: saved })
    await expect(button(reopened, '选中图片 2')).toBeVisible()
    await expect.poll(() => pixelAt(reopened, 480, 295)).toEqual([221, 34, 85, 255])
    await button(reopened, '选中图片 1').click()
    const svg = (await download(reopened, '导出选中 SVG')).toString()
    expect(svg.match(/<image\b/g)).toHaveLength(1)
    expect(svg).toContain(`data:image/png;base64,${png.buffer.toString('base64')}`)
    expect(svg).not.toContain('data:image/jpeg')
    await button(reopened, '删除').click()
    expect(sceneFrom(await download(reopened)).images).toHaveLength(1)
    await button(reopened, '撤销').click()
    expect(sceneFrom(await download(reopened))).toEqual(scene)
    await button(reopened, '选中图片 1').click()
    await button(reopened, '复制').click()
    await button(reopened, '新建').click()
    await button(reopened, '粘贴').click()
    await expect(button(reopened, '选中图片 1')).toHaveAttribute('aria-pressed', 'true')
    expect(sceneFrom(await download(reopened)).images).toEqual([scene.images![0]])
  } finally {
    await context.close()
  }
})

test('图片可移动、缩放、旋转；透明边按外框吸附，删图保线，撤销复接', async ({ page, browser }) => {
  await page.goto('/')
  await choose(page, '插入图片', await imageFile(page, 'image/png'))
  await expect(button(page, '选中图片 1')).toBeVisible()
  const [first] = sceneFrom(await download(page)).objects
  if (first.type !== 'image') throw new Error('expected image')
  await drag(page, await initialScenePoint(page, first.x, first.y), await initialScenePoint(page, first.x - 55, first.y - 30))
  const [moved] = sceneFrom(await download(page)).objects
  if (moved.type !== 'image') throw new Error('expected image')
  expect(moved.x).toBeCloseTo(first.x - 55, 0)
  expect(moved.y).toBeCloseTo(first.y - 30, 0)
  const corner = await initialScenePoint(page, moved.x + moved.width / 2, moved.y + moved.height / 2)
  await drag(page, corner, { x: corner.x + 45, y: corner.y + 30 })
  const [image] = sceneFrom(await download(page)).objects
  if (image.type !== 'image') throw new Error('expected image')
  expect(image.width).toBeGreaterThan(first.width)
  expect(image.height).toBeGreaterThan(first.height)
  expect(image.width / image.height).toBeCloseTo(2, 4)
  // The far right edge is transparent above the small blue patch, but remains a valid anchor.
  await button(page, '端点吸附').click()
  await chooseLine(page, '箭头')
  await drag(page, await initialScenePoint(page, image.x + image.width / 2 + 4, image.y - image.height * .35),
    await initialScenePoint(page, 770, 420))
  let scene = sceneFrom(await download(page)), line = scene.objects[1]
  if (line.type !== 'arrow') throw new Error('expected arrow')
  expect(line.startBinding).toMatchObject({ targetId: image.id, kind: 'edge', edge: 1, t: expect.closeTo(.15, 1) })
  const originalPoint = resolveEndpoints(line, scene.objects).start
  await button(page, '选中图片 1').click()
  const top = await initialScenePoint(page, image.x, image.y - image.height / 2)
  const center = await initialScenePoint(page, image.x, image.y)
  const radius = center.y - top.y + 40
  await drag(page, { x: top.x, y: top.y - 40 }, { x: center.x + radius * Math.SQRT1_2, y: center.y - radius * Math.SQRT1_2 })
  scene = sceneFrom(await download(page))
  expect(scene.objects[0].rotation).toBeCloseTo(45, 0)
  expect(scene.objects[1]).toEqual(line)
  const original = resolveEndpoints(line, scene.objects).start
  expect(original.y).toBeGreaterThan(originalPoint.y + 20)
  await button(page, '删除').click()
  const after = sceneFrom(await download(page))
  expect(after.images).toBeUndefined()
  line = after.objects[0]
  if (line.type !== 'arrow') throw new Error('expected arrow')
  expect(line.startBinding).toBeUndefined()
  const preserved = resolveEndpoints(line, after.objects).start
  expect(preserved.x).toBeCloseTo(original.x, 8)
  expect(preserved.y).toBeCloseTo(original.y, 8)
  await button(page, '撤销').click()
  const saved = await download(page)
  expect(sceneFrom(saved)).toEqual(scene)
  const context = await browser.newContext()
  try {
    const reopened = await context.newPage()
    await reopened.goto('/')
    await context.setOffline(true)
    await choose(reopened, '打开项目', { name: '图片吸附.json', mimeType: 'application/json', buffer: saved })
    await expect(button(reopened, '选中图片 1')).toBeVisible()
    await button(reopened, '选中箭头 1').click()
    await expect(reopened.getByRole('region', { name: '连接' })).toContainText('图片 1')
    const svg = (await download(reopened, '导出选中 SVG')).toString()
    expect(svg).toContain('<polyline ')
    expect(svg).not.toContain('<image ')
    await drag(reopened, await initialScenePoint(reopened, scene.objects[0].x, scene.objects[0].y),
      await initialScenePoint(reopened, scene.objects[0].x - 55, scene.objects[0].y))
    const continued = sceneFrom(await download(reopened))
    const linked = continued.objects[1]
    if (linked.type !== 'arrow') throw new Error('expected arrow')
    expect(linked).toEqual(scene.objects[1])
    expect(resolveEndpoints(linked, continued.objects).start.x).toBeCloseTo(original.x - 55, 0)
  } finally {
    await context.close()
  }
})

test('拒绝伪文件、不可解码和超限图片；损坏项目不破坏现有画布或历史', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  const real = await imageFile(page, 'image/png')
  await choose(page, '插入图片', real)
  await expect(button(page, '选中图片 1')).toBeVisible()
  const saved = sceneFrom(await download(page))
  const truncated = real.buffer.subarray(0, 33)
  const hugePixels = Buffer.from(real.buffer)
  hugePixels.writeUInt32BE(50_000, 16)
  hugePixels.writeUInt32BE(50_000, 20)
  for (const [buffer, message] of [
    [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), '内容有效的 PNG 或 JPG'],
    [truncated, '无法解码'],
    [Buffer.alloc(maxImageBytes + 1), '10 MiB'],
    [hugePixels, '1600 万像素'],
  ] as const) {
    await choose(page, '插入图片', { ...real, buffer })
    await expect(page.getByRole('alert')).toContainText(message)
    const notice = await page.getByRole('alert').boundingBox()
    expect(notice!.width).toBeGreaterThan(155)
    expect(notice!.height).toBeLessThan(90)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1280)
    expect(sceneFrom(await download(page))).toEqual(saved)
    await expect(button(page, '重做')).toBeDisabled()
  }
  // Keep the PNG container complete but damage its compressed pixel stream.
  const damagedData = Buffer.from(real.buffer)
  for (let i = 33; i + 12 < damagedData.length;) {
    const length = damagedData.readUInt32BE(i)
    if (damagedData.toString('ascii', i + 4, i + 8) === 'IDAT') { damagedData.fill(0, i + 8, i + 8 + length); break }
    i += length + 12
  }
  const malformed = encodeProject({ ...saved, images: [{ ...saved.images![0], data: damagedData.toString('base64') }] })
  await choose(page, '打开项目', { name: '损坏项目.json', mimeType: 'application/json', buffer: Buffer.from(malformed) })
  await expect(page.getByRole('alert')).toContainText('图片资源损坏')
  expect(sceneFrom(await download(page))).toEqual(saved)
  await button(page, '撤销').click()
  expect(sceneFrom(await download(page)).objects).toEqual([])
  await expect(button(page, '撤销')).toBeDisabled()
})

test('切换项目后，在途的本地图片读取不能写入新项目', async ({ page }) => {
  await page.goto('/')
  const png = await imageFile(page, 'image/png')
  await page.evaluate(() => {
    const original = File.prototype.arrayBuffer
    File.prototype.arrayBuffer = async function () {
      if (this.type === 'image/png') await new Promise<void>(resolve => window.addEventListener('release-image-read', () => resolve(), { once: true }))
      return original.call(this)
    }
  })
  await choose(page, '插入图片', png)
  await expect(button(page, '插入图片')).toBeDisabled()
  const project = { id: 'replacement', objects: [] }
  await choose(page, '打开项目', { name: '替换后.json', mimeType: 'application/json', buffer: Buffer.from(encodeProject(project)) })
  await expect(page.getByText('替换后', { exact: true })).toBeVisible()
  // Let the real bytes finish and start decoding, then import a fresh file into the new project.
  await page.evaluate(() => window.dispatchEvent(new Event('release-image-read')))
  await choose(page, '插入图片', await imageFile(page, 'image/jpeg'))
  await expect(button(page, '选中图片 1')).toBeVisible()
  const after = sceneFrom(await download(page))
  expect(after.id).toBe(project.id)
  expect(after.objects).toHaveLength(1)
  expect(after.images?.map(asset => asset.mime)).toEqual(['image/jpeg'])
})

test('异步图片完成时等正在拖动的对象落下，两次撤销可分别恢复', async ({ page }) => {
  await page.goto('/')
  const scene = { id: 'drag-import', objects: [{ id: 'rect', type: 'rectangle', x: 400, y: 235, rotation: 0,
    width: 130, height: 90, fill: '#e0eaf3', stroke: '#355985', strokeWidth: 2 }] } as const
  await choose(page, '打开项目', { name: '拖动.json', mimeType: 'application/json', buffer: Buffer.from(encodeProject(scene)) })
  await expect(button(page, '选中矩形 1')).toBeVisible()
  await page.evaluate(() => {
    const original = File.prototype.arrayBuffer
    File.prototype.arrayBuffer = async function () {
      if (this.type === 'image/png') await new Promise<void>(resolve => window.addEventListener('release-drag-import', () => resolve(), { once: true }))
      return original.call(this)
    }
    const decode = HTMLImageElement.prototype.decode
    HTMLImageElement.prototype.decode = async function () {
      await decode.call(this)
      document.documentElement.dataset.imageDecoded = 'yes'
    }
  })
  await choose(page, '插入图片', await imageFile(page, 'image/png'))
  const start = await initialScenePoint(page, 400, 235), finish = await initialScenePoint(page, 490, 235)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(finish.x, finish.y, { steps: 7 })
  await page.evaluate(() => window.dispatchEvent(new Event('release-drag-import')))
  await expect(page.locator('html')).toHaveAttribute('data-image-decoded', 'yes')
  await expect(button(page, '插入图片')).toBeDisabled()
  await page.mouse.up()
  await expect(button(page, '选中图片 1')).toBeVisible()
  expect(sceneFrom(await download(page)).objects[0].x).toBeCloseTo(490, 0)
  await button(page, '撤销').click()
  const moved = sceneFrom(await download(page))
  expect(moved.objects).toHaveLength(1)
  expect(moved.objects[0].x).toBeCloseTo(490, 0)
  await button(page, '撤销').click()
  expect(sceneFrom(await download(page))).toEqual(scene)
})
