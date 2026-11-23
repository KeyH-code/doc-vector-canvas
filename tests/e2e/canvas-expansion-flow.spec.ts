import { readFile, writeFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { PDFDocument } from 'pdf-lib'
import { atWorld } from '../../src/core/connections'
import { createHistory, undo } from '../../src/core/history'
import { createLocalEditGrant, submitLocalEdit } from '../../src/core/localSceneAccess'
import { readSceneGraph } from '../../src/core/sceneGraph'
import { decodeProject, encodeProject } from '../../src/project/projectFile'
import { graphFixture } from '../fixtures/documents/sceneGraphFixture'

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true })
const stage = (page: Page) => page.getByTestId('canvas-stage')
const zoom = (page: Page) => page.getByRole('combobox', { name: '画布缩放' })
type Point = { x: number; y: number }

async function choose(page: Page, label: string, name: string, mimeType: string, buffer: Buffer) {
  const pending = page.waitForEvent('filechooser')
  await button(page, label).click()
  await (await pending).setFiles({ name, mimeType, buffer })
}

async function open(page: Page, name: string, buffer: Buffer) {
  await choose(page, '打开项目', `${name}.json`, 'application/json', buffer)
  await expect(page.getByText(name, { exact: true })).toBeVisible()
}

async function download(page: Page, label = '保存项目') {
  const pending = page.waitForEvent('download')
  await button(page, label).click()
  return readFile((await (await pending).path())!)
}

function sceneFrom(data: Buffer) {
  const result = decodeProject(data.toString('utf8'))
  if (!result.ok) throw new Error(result.message)
  return result.scene
}

async function drag(page: Page, start: Point, ...points: Point[]) {
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  for (const end of points) await page.mouse.move(end.x, end.y, { steps: 10 })
  await page.mouse.up()
}

async function viewport(page: Page, center: Point) {
  const box = (await stage(page).boundingBox())!, scale = Number(await zoom(page).inputValue())
  return (x: number, y: number) => ({ x: box.x + box.width / 2 + (x - center.x) * scale,
    y: box.y + box.height / 2 + (y - center.y) * scale })
}

test('正式下载的多页项目按页授权编辑，离线重开后照常读关系和跨页撤销', async ({ page, browser }, testInfo) => {
  await page.goto('/')
  await open(page, '多页验收', Buffer.from(encodeProject(graphFixture())))
  await expect(button(page, '第 1 页').locator('img')).toBeVisible()
  const original = sceneFrom(await download(page)), history = createHistory(original)
  const target = { projectId: original.id, pageId: 'p2' }
  const grant = createLocalEditGrant(history, target, ['process'])!
  const command = { type: 'update', id: 'process', changes: { x: 128, y: 161 } }
  const rejected = submitLocalEdit(history, grant, { ...target, commands: [command, { type: 'delete', id: 'output' }] })
  expect(rejected).toMatchObject({ ok: false, code: 'out-of-scope', index: 1 })
  expect(rejected.history).toBe(history)
  const edited = submitLocalEdit(history, grant, { ...target, commands: [command] })
  expect(edited).toMatchObject({ ok: true, writtenIds: ['process'], derivedConnectorIds: ['incoming', 'main', 'branch'] })
  const changed = edited.history.scene
  expect(undo(edited.history).scene).toEqual(original)
  await writeFile(testInfo.outputPath('original.json'), encodeProject(original))
  await writeFile(testInfo.outputPath('local-edit.json'), encodeProject(changed))
  await writeFile(testInfo.outputPath('page-2-graph.json'), JSON.stringify(readSceneGraph(changed, target), null, 2))
  const ctx = await browser.newContext()
  try {
    const offline = await ctx.newPage()
    await offline.goto('/')
    await expect(button(offline, '打开项目')).toBeVisible()
    await ctx.setOffline(true)
    await open(offline, '局部修改', Buffer.from(encodeProject(changed)))
    await button(offline, '第 2 页').click()
    const scope = offline.getByRole('region', { name: '连接', exact: true })
    await button(offline, '选中曲线 1').click()
    await expect(scope.getByRole('button', { name: '定位连接对象 折线箭头 1' })).toBeVisible()
    const coordinates = await viewport(offline, { x: 100, y: 160 })
    await drag(offline, coordinates(128, 161), coordinates(142, 181))
    const moved = readSceneGraph(sceneFrom(await download(offline)), target)!
    expect(moved.objects.find(item => item.record.id === 'process')?.record.y).toBeCloseTo(181, 0)
    expect(moved.connectors.find(item => item.id === 'main')?.endpoints.start.y).toBeCloseTo(197, 0)
    await button(offline, '第 1 页').click()
    await button(offline, '撤销').click()
    await expect(button(offline, '第 2 页')).toHaveAttribute('aria-current', 'page')
    expect(sceneFrom(await download(offline))).toEqual(changed)
  } finally { await ctx.close() }
})

test('从空白到远处作图、图片外框和跨线连接，离线重开移动图片并导出混合 SVG', async ({ page, browser }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  const box = (await stage(page).boundingBox())!
  const pixel = (x: number, y: number) => ({ x: box.x + box.width / 2 + x, y: box.y + box.height / 2 + y })
  await button(page, '抓手').click()
  await drag(page, pixel(420, 0), pixel(-410, 0))
  await button(page, '矩形').click()
  await drag(page, pixel(-45, -42), pixel(45, 42))
  await button(page, '定位矩形 1').click()
  const rect = sceneFrom(await download(page)).objects[0]
  expect(rect.x).toBeGreaterThan(1000)
  await button(page, '抓手').click()
  await drag(page, pixel(120, 0), pixel(-245, 0))

  const table = await readFile(new URL('../fixtures/documents/flow-table.png', import.meta.url))
  await choose(page, '插入图片', 'Excel 表格.png', 'image/png', table)
  await expect(button(page, '选中图片 1')).toBeVisible()
  const image = sceneFrom(await download(page)).objects.find(object => object.type === 'image')!
  if (rect.type !== 'rectangle') throw new Error('expected rectangle')
  const at = await viewport(page, image), imageLeft = image.x - image.width / 2
  await button(page, '端点吸附').click()
  await button(page, '箭头').click()
  await button(page, '折线箭头').click()
  const knee = at(imageLeft - 55, image.y + 55)
  await drag(page, at(rect.x + rect.width / 2, rect.y), knee)
  await page.mouse.click(knee.x, knee.y)
  await expect(page.getByText(/点击落点继续折线/)).toBeVisible()
  const tableEdge = at(imageLeft, image.y + 24)
  await page.mouse.click(tableEdge.x, tableEdge.y)
  const joined = sceneFrom(await download(page)), address = { projectId: joined.id, pageId: null }
  const main = readSceneGraph(joined, address)!.connectors[0]
  expect(main.geometry.endBinding?.targetId).toBe(image.id)
  const path = main.geometry.path!
  expect(path.segments).toHaveLength(2)
  const start = atWorld(main.geometry, path.start), end = atWorld(main.geometry, path.segments[0].to)
  const join = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
  await button(page, '线条').click()
  await button(page, '曲线').click()
  await drag(page, at(join.x, join.y), at(join.x + 20, join.y + 52), at(join.x + 44, join.y + 97), at(join.x + 92, join.y + 132))
  const saved = await download(page), scene = sceneFrom(saved)
  const graph = readSceneGraph(scene, address)!
  expect(graph.relations).toContainEqual(expect.objectContaining({ connectorId: graph.connectors[1].id, targetId: main.id,
    end: 'start', direction: 'undirected', binding: expect.objectContaining({ kind: 'path', segment: 0 }) }))
  expect(graph.images).toHaveLength(1)
  expect(graph.images[0]).not.toHaveProperty('data')

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  try {
    const offline = await ctx.newPage()
    await offline.goto('/')
    await expect(button(offline, '打开项目')).toBeVisible()
    await ctx.setOffline(true)
    await open(offline, '真实闭环', saved)
    await button(offline, '定位图片 1').click()
    const from = await viewport(offline, image)
    await drag(offline, from(image.x, image.y), from(image.x, image.y + 26))
    const updatedFile = await download(offline)
    const updated = readSceneGraph(sceneFrom(updatedFile), address)!
    expect(updated.relations).toEqual(graph.relations)
    expect(updated.connectors[0].endpoints.end.y - graph.connectors[0].endpoints.end.y).toBeCloseTo(26, 0)
    await button(offline, '选中图片 1').click()
    await button(offline, '选中折线箭头 1').click({ modifiers: ['Shift'] })
    await button(offline, '选中曲线 1').click({ modifiers: ['Shift'] })
    const svg = (await download(offline, '导出选中 SVG')).toString('utf8')
    expect(svg).toContain(`data:image/png;base64,${table.toString('base64')}`)
    expect(svg.match(/<path\b/g)).toHaveLength(2)
    expect(svg).not.toContain('<rect ')
    await writeFile(testInfo.outputPath('closed-flow.json'), updatedFile)
    await writeFile(testInfo.outputPath('mixed-selection.svg'), svg)
  } finally { await ctx.close() }
})

test('图片型 PDF 从正式入口导入后，不把表格像素猜成原文', async ({ page }) => {
  const raster = await readFile(new URL('../fixtures/documents/flow-table.png', import.meta.url))
  const pdf = await PDFDocument.create()
  const image = await pdf.embedPng(raster)
  pdf.addPage([image.width, image.height]).drawImage(image, { x: 0, y: 0, width: image.width, height: image.height })
  await page.goto('/')
  await choose(page, '打开项目', '扫描页.pdf', 'application/pdf', Buffer.from(await pdf.save()))
  await expect(button(page, '第 1 页').locator('img')).toBeVisible()
  const project = sceneFrom(await download(page)), address = { projectId: project.id, pageId: project.document!.pages[0].id }
  expect(readSceneGraph(project, address)?.source).toEqual({ kind: 'pdf', locked: true, text: { status: 'unavailable' } })
  expect(readSceneGraph(project, address)?.objects).toEqual([])
})

test('离线重开时用内嵌 PDF 校正原文缓存，不能把错页缓存当作本页原文', async ({ page, context }) => {
  await page.goto('/')
  await expect(button(page, '打开项目')).toBeVisible()
  await context.setOffline(true)
  const original = graphFixture(), doc = original.document!
  const wrong = { ...original, document: { ...doc, pages: [doc.pages[0], { ...doc.pages[1], text: doc.pages[0].text }] } }
  await open(page, '原文校对', Buffer.from(encodeProject(wrong)))
  const saved = sceneFrom(await download(page))
  expect(saved).toEqual(original)
  expect(button(page, '撤销')).toBeDisabled()
})
