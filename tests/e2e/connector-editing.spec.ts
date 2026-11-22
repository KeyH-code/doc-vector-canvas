import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { resolveEndpoints } from '../../src/core/connections'
import { polygonVertices } from '../../src/core/geometry'
import type { BoxObject, CanvasObject, LineObject } from '../../src/core/scene'
import { decodeProject, encodeProject } from '../../src/project/projectFile'
import { initialScenePoint } from './initial-scene-point'
import { chooseLine } from './choose-line'

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true })
const shapeStyle = { rotation: 0, stroke: '#355985', strokeWidth: 3, fill: '#e0eaf3' }
const a: BoxObject = { ...shapeStyle, type: 'rectangle', id: 'a', x: 240, y: 240, width: 160, height: 120 }
const b: BoxObject = { ...shapeStyle, type: 'ellipse', id: 'b', x: 630, y: 240, width: 160, height: 120 }
const c: BoxObject = { ...shapeStyle, type: 'rectangle', id: 'c', x: 610, y: 410, width: 110, height: 90 }

async function open(page: Page, objects: readonly CanvasObject[], name = '连接练习') {
  await page.goto('/')
  const pending = page.waitForEvent('filechooser')
  await button(page, '打开项目').click()
  await (await pending).setFiles({ name: `${name}.json`, mimeType: 'application/json', buffer: Buffer.from(encodeProject({ id: 'connections', objects })) })
  await expect(page.getByText(name, { exact: true })).toBeVisible()
}

async function download(page: Page, label: string) {
  const pending = page.waitForEvent('download')
  await button(page, label).click()
  return readFile((await (await pending).path())!, 'utf8')
}

async function save(page: Page) {
  const result = decodeProject(await download(page, '保存项目'))
  if (!result.ok) throw new Error(result.message)
  return result.scene.objects
}

async function drag(page: Page, from: [number, number], to: [number, number]) {
  const [start, end] = await Promise.all([initialScenePoint(page, ...from), initialScenePoint(page, ...to)])
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 10 })
  await page.mouse.up()
}

function canvasPixel(page: Page, pixel: { x: number; y: number }) {
  return page.locator('canvas[data-fabric="main"]').evaluate((el: HTMLCanvasElement, point) => {
    const b = el.getBoundingClientRect(), scale = el.width / b.width
    return Array.from(el.getContext('2d')!.getImageData((point.x - b.x) * scale, (point.y - b.y) * scale, 1, 1).data)
  }, pixel)
}

function connector(objects: readonly CanvasObject[], id?: string) {
  const line = objects.find(object => id ? object.id === id : object.type === 'arrow')
  if (line?.type !== 'line' && line?.type !== 'arrow') throw new Error('缺少线段')
  return line
}

test('默认可在闭合图形内画线；主动吸附才记录关系且可定位对端', async ({ page }) => {
  await open(page, [a, b, c])
  const snap = button(page, '端点吸附')
  await expect(snap).toHaveAttribute('aria-pressed', 'false')
  await chooseLine(page, '直线')
  await drag(page, [174, 217], [305, 217])
  await expect(page.getByRole('status')).toHaveText('已选中 1 个直线')
  await expect(page.getByRole('region', { name: '连接', exact: true })).toContainText('暂无连接')
  const free = (await save(page)).at(-1)
  expect(free).toMatchObject({ type: 'line' })
  expect(free).not.toHaveProperty('startBinding')
  await snap.click()
  await chooseLine(page, '箭头')
  await drag(page, [324, 265], [548, 240])
  const objects = await save(page), arrow = connector(objects)
  expect(arrow.startBinding).toMatchObject({ targetId: 'a', kind: 'edge', edge: 1 })
  expect(arrow.endBinding).toMatchObject({ targetId: 'b', kind: 'ellipse' })
  expect(resolveEndpoints(arrow, objects).start.x).toBeCloseTo(320, 5)
  await expect(page.getByRole('region', { name: '连接', exact: true })).toContainText('起点')
  await button(page, '定位连接对象 矩形 1').click()
  await expect(page.getByRole('status')).toHaveText('已选中 1 个矩形')
  const links = page.getByRole('region', { name: '连接', exact: true })
  await expect(links).toContainText('出向')
  await expect(links).not.toContainText('直线')
  await links.getByRole('button', { name: '定位连接对象 椭圆 1' }).click()
  await expect(page.getByRole('status')).toHaveText('已选中 1 个椭圆')
  await expect(links).toContainText('入向')
})

const bound: LineObject = { type: 'arrow', id: 'arrow', x: 435, y: 240, dx: 230, dy: 0, rotation: 0,
  stroke: '#2563eb', strokeWidth: 4, startBinding: { targetId: 'a', kind: 'edge', edge: 1, t: .5 },
  endBinding: { targetId: 'b', kind: 'ellipse', angle: Math.PI } }

test('关闭吸附后旧关系仍随动，删除和撤销保留线并可重开、只导出箭头', async ({ page, browser }) => {
  await open(page, [a, b, c, bound])
  const snap = button(page, '端点吸附')
  await snap.click()
  await snap.click()
  await expect(button(page, '撤销')).toBeDisabled()
  await drag(page, [240, 240], [280, 310])
  const moved = await save(page)
  expect(moved[0].x).toBeCloseTo(280, 0)
  expect(connector(moved)).toEqual(bound)
  const endpoints = resolveEndpoints(bound, moved)
  expect(endpoints.start.x).toBeCloseTo(360, 0)
  expect(endpoints.start.y).toBeCloseTo(310, 0)
  await button(page, '选中箭头 1').click()
  const svg = await download(page, '导出选中 SVG')
  const exported = await page.evaluate(source => {
    const doc = new DOMParser().parseFromString(source, 'image/svg+xml')
    const poly = doc.querySelector('polyline')!
    const points = poly.getAttribute('points')!.trim().split(/\s+/).slice(0, 2).map(p => p.split(',').map(Number))
    const transform = new DOMMatrix(poly.closest('g')!.getAttribute('transform')!.slice(7, -1).split(/\s+/).map(Number))
    return { shapes: doc.querySelectorAll('rect, ellipse, polygon, image').length,
      points: points.map(([x, y]) => { const p = new DOMPoint(x, y).matrixTransform(transform); return [p.x, p.y] }) }
  }, svg)
  expect(exported.shapes).toBe(0)
  expect(exported.points[0][0]).toBeCloseTo(endpoints.start.x, 2)
  expect(exported.points[0][1]).toBeCloseTo(endpoints.start.y, 2)
  expect(exported.points[1][0]).toBeCloseTo(endpoints.end.x, 2)
  expect(exported.points[1][1]).toBeCloseTo(endpoints.end.y, 2)
  await button(page, '选中矩形 1').click()
  await button(page, '删除').click()
  const deleted = await save(page)
  const preserved = connector(deleted)
  expect(preserved.id).toBe(bound.id)
  expect(preserved.startBinding).toBeUndefined()
  expect(preserved.endBinding).toEqual(bound.endBinding)
  const detachedEnds = resolveEndpoints(preserved, deleted)
  expect(detachedEnds.start.x).toBeCloseTo(endpoints.start.x, 10)
  expect(detachedEnds.start.y).toBeCloseTo(endpoints.start.y, 10)
  expect(detachedEnds.end).toEqual(endpoints.end)
  await button(page, '撤销').click()
  expect(await save(page)).toEqual(moved)
  const newPage = await browser.newPage()
  try {
    const file = await download(page, '保存项目')
    await newPage.goto('/')
    const pending = newPage.waitForEvent('filechooser')
    await button(newPage, '打开项目').click()
    await (await pending).setFiles({ name: '重新打开.json', mimeType: 'application/json', buffer: Buffer.from(file) })
    await button(newPage, '选中箭头 1').click()
    await expect(newPage.getByRole('region', { name: '连接', exact: true })).toContainText('椭圆 1')
    expect(await save(newPage)).toEqual(moved)
  } finally {
    await newPage.close()
  }
})

test('已绑定线不能整体拖离；独立端点可解除或改接', async ({ page }) => {
  await open(page, [a, b, c, bound])
  await button(page, '选中箭头 1').click()
  await drag(page, [435, 240], [437, 320])
  await expect(button(page, '撤销')).toBeDisabled()
  await button(page, '端点吸附').click()
  await drag(page, [550, 240], [610, 362])
  const first = await save(page)
  expect(connector(first).endBinding).toMatchObject({ targetId: 'c', edge: 0 })
  expect(connector(first).startBinding).toEqual(bound.startBinding)
  await drag(page, [320, 240], [375, 336])
  const second = await save(page)
  expect(connector(second).startBinding).toBeUndefined()
  expect(connector(second).endBinding).toEqual(connector(first).endBinding)
  expect(resolveEndpoints(connector(second), second).start.x).toBeCloseTo(375, 0)
  await button(page, '撤销').click()
  expect(await save(page)).toEqual(first)
})

test('端点暂时重合时，可单独拖离箭头起点且保留终点绑定', async ({ page }) => {
  const other: BoxObject = { ...a, id: 'other', x: 400 }
  const samePoint: LineObject = { ...bound, endBinding: { targetId: other.id, kind: 'edge', edge: 3, t: .5 } }
  await open(page, [a, other, samePoint])
  await button(page, '选中箭头 1').click()
  const overlap = await initialScenePoint(page, 320, 240)
  const free = await initialScenePoint(page, 330, 345)
  await page.mouse.move(overlap.x - 11, overlap.y)
  await page.mouse.down()
  await page.mouse.move(free.x, free.y, { steps: 8 })
  await page.mouse.up()
  const objects = await save(page), changed = connector(objects)
  expect(changed.startBinding).toBeUndefined()
  expect(changed.endBinding).toEqual(samePoint.endBinding)
  expect(resolveEndpoints(changed, objects).start.y).toBeCloseTo(345, 0)
})

test('200% 下吸附旋转五角星的凹边与转过角度的菱形，而不是包围框', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  const star: BoxObject = { ...a, type: 'star', id: 'star', x: 425, y: 275, width: 146, height: 130, rotation: 90 }
  const diamond: BoxObject = { ...b, type: 'diamond', id: 'diamond', x: 650, y: 305, width: 100, height: 90, rotation: 90 }
  await open(page, [star, diamond])
  await page.getByRole('combobox', { name: '画布缩放' }).selectOption('2')
  await button(page, '端点吸附').click()
  await chooseLine(page, '箭头')
  const [p, q] = polygonVertices('star', star.width, star.height).slice(1, 3)
  const inner: [number, number] = [star.x - (p.y + q.y) / 2, star.y + (p.x + q.x) / 2]
  const tip = await initialScenePoint(page, ...inner)
  const before = await canvasPixel(page, tip)
  await page.mouse.move(tip.x + 2, tip.y + 2)
  await expect.poll(() => canvasPixel(page, tip)).not.toEqual(before)
  await expect(button(page, '撤销')).toBeDisabled() // hover preview is not a project edit
  await drag(page, [inner[0] + 1, inner[1] + 1], [627, 280])
  const objects = await save(page), line = connector(objects)
  expect(line.startBinding).toMatchObject({ targetId: 'star', kind: 'edge', edge: 1, t: expect.closeTo(.5, 1) })
  expect(line.endBinding).toMatchObject({ targetId: 'diamond', kind: 'edge' })
  await chooseLine(page, '直线')
  await drag(page, [star.x + star.height / 2, star.y + star.width / 2], [540, 410])
  expect((await save(page)).at(-1)).not.toHaveProperty('startBinding')
})

test('多选移动只平移自由端；复制同选宿主重映射其绑定', async ({ page }) => {
  const partial = { ...bound, endBinding: undefined }
  await open(page, [a, b, partial])
  await button(page, '选中矩形 1').click()
  await button(page, '选中箭头 1').click({ modifiers: ['Shift'] })
  await expect(page.getByRole('status')).toHaveText('已选中 2 个对象')
  await drag(page, [240, 240], [280, 280])
  const moved = await save(page), movedLine = connector(moved)
  expect(moved[0].x).toBeCloseTo(280, 0)
  expect(movedLine.x).toBeCloseTo(bound.x + 40, 0)
  expect(movedLine.startBinding).toEqual(bound.startBinding)
  const endpoints = resolveEndpoints(movedLine, moved)
  expect(endpoints.start.x).toBeCloseTo(360, 0)
  expect(endpoints.end.x).toBeCloseTo(590, 0)
  await button(page, '复制').click()
  await button(page, '粘贴').click()
  const pasted = await save(page)
  const [hostCopy, lineCopy] = pasted.slice(3) as [BoxObject, LineObject]
  expect(lineCopy.startBinding).toMatchObject({ targetId: hostCopy.id })
  expect(resolveEndpoints(lineCopy, pasted).start.x).toBeCloseTo(endpoints.start.x + 24, 10)
  expect(resolveEndpoints(lineCopy, pasted).end.x).toBeCloseTo(endpoints.end.x + 24, 10)
  await button(page, '撤销').click()
  expect(await save(page)).toEqual(moved)
  await button(page, '选中箭头 1').click()
  await button(page, '复制').click()
  await button(page, '粘贴').click()
  const lone = (await save(page)).at(-1) as LineObject
  expect(lone).not.toHaveProperty('startBinding')
  expect(resolveEndpoints(lone, []).start.x).toBeCloseTo(endpoints.start.x + 24, 10)
})

test('拖动两宿主与箭头时画面实时跟随，提交只移动宿主且一次撤销', async ({ page }) => {
  await open(page, [a, b, bound])
  await button(page, '选中矩形 1').click()
  await button(page, '选中椭圆 1').click({ modifiers: ['Shift'] })
  await button(page, '选中箭头 1').click({ modifiers: ['Shift'] })
  await expect(page.getByRole('status')).toHaveText('已选中 3 个对象')
  const start = await initialScenePoint(page, 240, 240)
  const end = await initialScenePoint(page, 280, 320)
  const oldInk = await initialScenePoint(page, 450, 240)
  const newInk = await initialScenePoint(page, 490, 320)
  await expect.poll(() => canvasPixel(page, oldInk)).toEqual([37, 99, 235, 255])
  expect(await canvasPixel(page, newInk)).toEqual([0, 0, 0, 0])
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 8 })
  await expect.poll(() => canvasPixel(page, newInk)).toEqual([37, 99, 235, 255])
  expect(await canvasPixel(page, oldInk)).toEqual([0, 0, 0, 0])
  await expect(button(page, '撤销')).toBeDisabled()
  await page.mouse.up()
  const moved = await save(page)
  expect(moved[0].x).toBeCloseTo(280, 0)
  expect(moved[1].x).toBeCloseTo(670, 0)
  expect(moved[2]).toEqual(bound)
  await button(page, '撤销').click()
  expect(await save(page)).toEqual([a, b, bound])
  await expect(button(page, '撤销')).toBeDisabled()
})

test('从主线中间接出分支，随主线的宿主移动，删主线后可撤销', async ({ page }) => {
  await open(page, [a, b, bound])
  await button(page, '端点吸附').click()
  await chooseLine(page, '直线')
  await drag(page, [435, 241], [473, 383])
  const original = await save(page)
  const leaf = original.at(-1) as LineObject
  expect(leaf.startBinding).toMatchObject({ targetId: bound.id, kind: 'path', segment: 0, t: expect.closeTo(.5, 1) })
  await expect(page.getByRole('region', { name: '连接', exact: true })).toContainText('箭头 1')
  await drag(page, [240, 240], [240, 310])
  const moved = await save(page)
  const current = resolveEndpoints(leaf, moved)
  expect(current.start.y).toBeCloseTo(275, 0)
  await button(page, '选中箭头 1').click()
  await expect(page.getByRole('region', { name: '连接', exact: true })).toContainText('直线 1')
  await button(page, '删除').click()
  const remaining = await save(page)
  const released = remaining.at(-1) as LineObject
  expect(released.startBinding).toBeUndefined()
  expect(resolveEndpoints(released, remaining).start.y).toBeCloseTo(current.start.y, 8)
  await button(page, '撤销').click()
  expect(await save(page)).toEqual(moved)
})

test('旧存档的文字实测外框可吸附，布局改变后端点随外框更新', async ({ page }) => {
  const text = { id: 'label', type: 'text', x: 400, y: 240, rotation: 0, text: 'WWWWWW', fontFamily: 'Microsoft YaHei, sans-serif', fontSize: 42, color: '#355985' } as const
  await open(page, [text])
  const width = await page.evaluate(({ text, fontFamily, fontSize }) => {
    const ctx = document.createElement('canvas').getContext('2d')!
    ctx.font = `${fontSize}px ${fontFamily}`
    return ctx.measureText(text).width
  }, text)
  await button(page, '端点吸附').click()
  await chooseLine(page, '箭头')
  await drag(page, [text.x + width / 2 + 2, 240], [720, 319])
  const before = await save(page), linked = connector(before)
  expect(linked.startBinding).toMatchObject({ targetId: text.id, kind: 'edge', edge: 1 })
  expect(resolveEndpoints(linked, before).start.x).toBeCloseTo(text.x + width / 2, 0)
  await button(page, '选中文字 1').click()
  await page.getByLabel('字号', { exact: true }).fill('63')
  await page.getByLabel('字号', { exact: true }).press('Enter')
  const after = await save(page)
  expect(connector(after)).toEqual(linked)
  expect(resolveEndpoints(linked, after).start.x).toBeCloseTo(text.x + width * .75, 0)
})

test('线端吸附曲线本身和笔迹，导出只含分支，重开仍认得两个锚点', async ({ page }) => {
  const main: LineObject = { ...bound, id: 'curve', type: 'line', x: 285, y: 220, dx: 200, dy: 0, startBinding: undefined, endBinding: undefined,
    path: { kind: 'curve', start: { x: 0, y: 0 }, segments: [{ id: 0, c1: { x: 0, y: -80 }, c2: { x: 200, y: -80 }, to: { x: 200, y: 0 } }] } }
  const ink = { id: 'ink', type: 'stroke', x: 560, y: 350, rotation: 0, stroke: '#7c3aed', strokeWidth: 5,
    points: [{ x: -55, y: 0 }, { x: 40, y: 0 }, { x: 75, y: 35 }] } as const
  await open(page, [main, ink])
  await button(page, '端点吸附').click()
  await chooseLine(page, '箭头')
  await drag(page, [385, 158], [540, 353])
  const source = await download(page, '保存项目'), result = decodeProject(source)
  if (!result.ok) throw new Error(result.message)
  const branch = connector(result.scene.objects)
  expect(branch.startBinding).toMatchObject({ targetId: 'curve', kind: 'path', segment: 0, t: expect.closeTo(.5, 1) })
  expect(branch.endBinding).toMatchObject({ targetId: 'ink', kind: 'path', segment: 0 })
  const actual = resolveEndpoints(branch, result.scene.objects)
  expect(actual.start.y).toBeCloseTo(160, 0)
  expect(actual.end.y).toBeCloseTo(350, 6)
  const svg = await download(page, '导出选中 SVG')
  expect(svg.match(/<polyline /g)).toHaveLength(1)
  expect(svg).not.toContain('<path ')
  await page.reload()
  const pending = page.waitForEvent('filechooser')
  await button(page, '打开项目').click()
  await (await pending).setFiles({ name: '跨路径.json', mimeType: 'application/json', buffer: Buffer.from(source) })
  await button(page, '选中箭头 1').click()
  await expect(page.getByRole('region', { name: '连接', exact: true })).toContainText('笔迹 1')
  expect(await download(page, '导出选中 SVG')).toBe(svg)
})
