import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { initialScenePoint } from './initial-scene-point'
import { encodeProject } from '../../src/project/projectFile'
import { pathTip } from '../../src/core/linePaths'

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true })

async function download(page: Page, label = '保存项目') {
  const pending = page.waitForEvent('download')
  await button(page, label).click()
  return readFile((await (await pending).path())!)
}

async function at(page: Page, x: number, y: number) {
  const point = await initialScenePoint(page, x, y)
  await page.mouse.click(point.x, point.y)
}

test('折线箭头在选择模式和项目重开后可续画而不新建对象', async ({ page }) => {
  await page.goto('/')
  await button(page, '箭头').click()
  await button(page, '折线箭头').click()
  const start = await initialScenePoint(page, 265, 235), end = await initialScenePoint(page, 425, 235)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 6 })
  await page.mouse.up()
  await expect(button(page, '选择')).toHaveAttribute('aria-pressed', 'true')
  const first = JSON.parse((await download(page)).toString()).scene.objects[0]
  expect(first.path.segments).toHaveLength(1)
  await at(page, 425, 235)
  await expect(page.getByText('点击落点继续折线 · Esc 取消', { exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  expect(JSON.parse((await download(page)).toString()).scene.objects).toEqual([first])
  await at(page, 425, 235)
  const pressed = await initialScenePoint(page, 425, 300), released = await initialScenePoint(page, 420, 350)
  await page.mouse.move(pressed.x, pressed.y)
  await page.mouse.down()
  await page.mouse.move(released.x, released.y, { steps: 5 })
  await page.mouse.up()
  await page.keyboard.press('Escape')
  expect(JSON.parse((await download(page)).toString()).scene.objects).toEqual([first])
  await at(page, 425, 235)
  await at(page, 425, 355)
  await at(page, 425, 355)
  await at(page, 580, 355)
  const saved = await download(page)
  const savedObjects = JSON.parse(saved.toString()).scene.objects
  expect(savedObjects).toHaveLength(1)
  expect(savedObjects[0].id).toBe(first.id)
  expect(savedObjects[0].path.segments).toHaveLength(3)
  await page.reload()
  const pending = page.waitForEvent('filechooser')
  await button(page, '打开项目').click()
  await (await pending).setFiles({ name: '折线.json', mimeType: 'application/json', buffer: saved })
  await button(page, '选中折线箭头 1').click()
  await at(page, 580, 355)
  await at(page, 615, 290)
  expect(JSON.parse((await download(page)).toString()).scene.objects[0].path.segments).toHaveLength(4)
  const svg = (await download(page, '导出选中 SVG')).toString()
  const pathData = /<path[^>]+\bd="([^"]+)"/.exec(svg)?.[1]
  expect(pathData?.match(/\bM\b/g)).toHaveLength(2) // One shaft and a single V head.
  await button(page, '撤销').click()
  expect(JSON.parse((await download(page)).toString()).scene.objects).toEqual(savedObjects)
})

test('手绘曲线箭头以可编辑矢量保存，重开后可以拖动末端', async ({ page }) => {
  await page.goto('/')
  await button(page, '箭头').click()
  await button(page, '曲线箭头').click()
  const points = await Promise.all([[250, 275], [289, 210], [340, 205], [400, 280], [470, 332], [515, 325], [568, 274]]
    .map(([x, y]) => initialScenePoint(page, x, y)))
  await page.mouse.move(points[0].x, points[0].y)
  await page.mouse.down()
  for (const point of points.slice(1)) await page.mouse.move(point.x, point.y, { steps: 5 })
  await page.mouse.up()
  const saved = await download(page)
  const original = JSON.parse(saved.toString()).scene.objects[0]
  expect(original.path.kind).toBe('curve')
  expect(original.path.segments.length).toBeGreaterThan(2)
  const svg = (await download(page, '导出选中 SVG')).toString()
  expect(svg).toMatch(/<path[^>]+\bd="[^"]*\bC\b/)
  expect(svg).not.toContain('<image')
  await page.reload()
  const pending = page.waitForEvent('filechooser')
  await button(page, '打开项目').click()
  await (await pending).setFiles({ name: '曲线.json', mimeType: 'application/json', buffer: saved })
  await button(page, '选中曲线箭头 1').click()
  const zoom = page.getByRole('combobox', { name: '画布缩放' })
  await zoom.selectOption('2')
  expect((await download(page, '导出选中 SVG')).toString()).toBe(svg)
  await zoom.selectOption('1')
  const end = await initialScenePoint(page, 568, 274), moved = await initialScenePoint(page, 605, 230)
  await page.mouse.move(end.x, end.y)
  await page.mouse.down()
  await page.mouse.move(moved.x, moved.y, { steps: 8 })
  await page.mouse.up()
  const updated = JSON.parse((await download(page)).toString()).scene.objects[0]
  expect(updated.id).toBe(original.id)
  expect(updated.path.segments.slice(0, -1)).toEqual(original.path.segments.slice(0, -1))
  expect(updated.path.segments.at(-1).to).not.toEqual(original.path.segments.at(-1).to)
})

test('续画已绑定的末端需确认，取消保留连接，撤销恢复旧绑定', async ({ page }) => {
  await page.goto('/')
  const pending = page.waitForEvent('filechooser')
  await button(page, '打开项目').click()
  const stroke = '#355985'
  const scene = { id: 'bound-polyline', objects: [
    { id: 'host', type: 'rectangle', x: 530, y: 235, rotation: 0, width: 100, height: 80, fill: '#e0eaf3', stroke, strokeWidth: 2 },
    { id: 'arrow', type: 'arrow', x: 290, y: 235, rotation: 0, stroke, strokeWidth: 4, dx: 150, dy: 0,
      path: { kind: 'polyline', start: { x: 0, y: 0 }, segments: [{ id: 0, to: { x: 150, y: 0 } }] },
      endBinding: { targetId: 'host', kind: 'edge', edge: 3, t: .5 } },
  ] } as const
  await (await pending).setFiles({ name: '绑定折线.json', mimeType: 'application/json', buffer: Buffer.from(encodeProject(scene)) })
  await button(page, '选中折线箭头 1').click()
  await at(page, 480, 235)
  await expect(page.getByText(/确认后更新原末端连接/)).toBeVisible()
  await page.keyboard.press('Escape')
  expect(JSON.parse((await download(page)).toString()).scene).toEqual(scene)
  await at(page, 480, 235)
  await at(page, 480, 355)
  const next = JSON.parse((await download(page)).toString()).scene.objects[1]
  expect(next).not.toHaveProperty('endBinding')
  expect(next.path.segments[0]).toMatchObject({ id: 0, to: { x: 190, y: 0 } })
  expect(next.path.segments).toHaveLength(2)
  await button(page, '撤销').click()
  expect(JSON.parse((await download(page)).toString()).scene).toEqual(scene)
})

test('曲线箭头越过边缘一点再吸回，不会在宿主处掉头', async ({ page }) => {
  await page.goto('/')
  const file = page.waitForEvent('filechooser')
  await button(page, '打开项目').click()
  const scene = { id: 'curve-snap', objects: [{ type: 'rectangle', id: 'host', x: 550, y: 270, rotation: 0, width: 100, height: 120,
    fill: '#e0eaf3', stroke: '#355985', strokeWidth: 2 }] } as const
  await (await file).setFiles({ name: '曲线吸附.json', mimeType: 'application/json', buffer: Buffer.from(encodeProject(scene)) })
  await button(page, '端点吸附').click()
  await button(page, '箭头').click()
  await button(page, '曲线箭头').click()
  const points = await Promise.all([[325, 260], [400, 239], [475, 257], [508, 270]].map(([x, y]) => initialScenePoint(page, x, y)))
  await page.mouse.move(points[0].x, points[0].y)
  await page.mouse.down()
  for (const point of points.slice(1)) await page.mouse.move(point.x, point.y, { steps: 10 })
  await page.mouse.up()
  const arrow = JSON.parse((await download(page)).toString()).scene.objects.at(-1)
  expect(arrow.endBinding).toMatchObject({ targetId: 'host', kind: 'edge', edge: 3 })
  expect(pathTip(arrow.path).tangent.x).toBeGreaterThan(0)
  expect(arrow.path.segments.every((part: { to: { x: number } }) => arrow.x + part.to.x <= 500.001)).toBe(true)
})
