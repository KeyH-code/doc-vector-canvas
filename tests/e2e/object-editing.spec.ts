import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { decodeProject, encodeProject } from '../../src/project/projectFile'
import type { CanvasObject, LineObject, RectangleObject } from '../../src/core/scene'
import { initialScenePoint as xy } from './initial-scene-point'

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true })
const field = (page: Page, name: string) => page.getByLabel(name, { exact: true })
const stage = (page: Page) => page.getByTestId('canvas-stage')
const editor = (page: Page) => page.locator('textarea[data-fabric="textarea"]')
const rect = (id: string, x: number, y: number): RectangleObject => ({ type: 'rectangle', id, x, y, width: 120, height: 80,
  rotation: 0, fill: '#e0eaf3', stroke: '#6381a2', strokeWidth: 2 })
const label: CanvasObject = { id: 'text', type: 'text', x: 350, y: 285, rotation: 0, text: '原文字',
  fontFamily: 'Microsoft YaHei', fontSize: 34, color: '#343e4e' }

async function load(page: Page, objects: CanvasObject[]) {
  await page.goto('/')
  const choosing = page.waitForEvent('filechooser')
  await button(page, '打开项目').click()
  await (await choosing).setFiles({ name: '图元测试.json', mimeType: 'application/json', buffer: Buffer.from(encodeProject({ id: 'scene', objects })) })
  await expect(page.getByRole('list', { name: '画布对象' }).getByRole('listitem')).toHaveCount(objects.length)
}

async function saved(page: Page) {
  const downloading = page.waitForEvent('download')
  await button(page, '保存项目').click()
  const source = await readFile((await (await downloading).path())!, 'utf8')
  const project = decodeProject(source)
  if (!project.ok) throw new Error(project.message)
  return project.scene.objects
}

async function click(page: Page, x: number, y: number, twice = false) {
  const p = await xy(page, x, y)
  if (twice) await page.mouse.dblclick(p.x, p.y)
  else await page.mouse.click(p.x, p.y)
}

async function drag(page: Page, from: [number, number], to: [number, number]) {
  const a = await xy(page, ...from), b = await xy(page, ...to)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move(b.x, b.y, { steps: 10 })
  await page.mouse.up()
}

test('旋转手柄提交一次，撤销恢复原角度', async ({ page }) => {
  const source = rect('a', 250, 220)
  await load(page, [source])
  await click(page, 250, 220)
  const center = await xy(page, 250, 220), top = await xy(page, 250, 179)
  await page.mouse.move(top.x, top.y - 40)
  await page.mouse.down()
  await page.mouse.move(center.x + 74, center.y, { steps: 8 })
  await page.mouse.up()
  const [turned] = await saved(page)
  expect(Math.abs(turned.rotation - 90)).toBeLessThan(2)
  await button(page, '撤销').click()
  expect(await saved(page)).toEqual([source])
  await expect(button(page, '撤销')).toBeDisabled()
})

test('Shift 加选并移动，两件图元一次撤销，未选中的图元不变', async ({ page }) => {
  const a = rect('a', 220, 200), b = rect('b', 435, 240), c = rect('c', 725, 370)
  await load(page, [a, b, c])
  await click(page, a.x, a.y)
  await page.keyboard.down('Shift')
  await click(page, b.x, b.y)
  await page.keyboard.up('Shift')
  await expect(page.getByRole('status')).toHaveText('已选中 2 个对象')
  await drag(page, [a.x, a.y], [a.x + 85, a.y + 65])
  const [first, second, third] = await saved(page)
  expect(first.x - a.x).toBeCloseTo(85, -1)
  expect(second.x - b.x).toBeCloseTo(first.x - a.x, 3)
  expect(second.y - b.y).toBeCloseTo(first.y - a.y, 3)
  expect(third).toEqual(c)
  await button(page, '撤销').click()
  expect(await saved(page)).toEqual([a, b, c])
  await expect(button(page, '撤销')).toBeDisabled()
})

test('框选后复制粘贴生成独立 ID，删除与撤销按组生效', async ({ page }) => {
  const a = rect('a', 230, 180), b = rect('b', 420, 280)
  await load(page, [a, b])
  await drag(page, [96, 75], [532, 372])
  await expect(page.getByRole('status')).toHaveText('已选中 2 个对象')
  await page.keyboard.press('Control+c')
  await page.keyboard.press('Control+v')
  await expect(page.getByRole('list', { name: '画布对象' }).getByRole('listitem')).toHaveCount(4)
  const objects = await saved(page)
  expect(new Set(objects.map(o => o.id)).size).toBe(4)
  expect(objects.slice(0, 2)).toEqual([a, b])
  expect(objects[2]).toMatchObject({ fill: a.fill, x: expect.any(Number) })
  expect(objects[2].x).toBeGreaterThan(a.x)
  await page.keyboard.press('Delete')
  expect(await saved(page)).toEqual([a, b])
  await page.keyboard.press('Control+z')
  expect(await saved(page)).toEqual(objects)
  await page.keyboard.press('Control+Shift+z')
  expect(await saved(page)).toEqual([a, b])
})

test('矩形和文字展示各自属性，修改副本不会改原件', async ({ page }) => {
  const a = rect('a', 270, 180)
  await load(page, [a, label])
  await click(page, a.x, a.y)
  await expect(field(page, '填充颜色')).toBeVisible()
  await expect(field(page, '字体')).toHaveCount(0)
  await button(page, '复制').click()
  await button(page, '粘贴').click()
  await field(page, '填充颜色').fill('#ad4033')
  await page.getByRole('combobox', { name: '线型', exact: true }).selectOption('dashed')
  const [original, , copied] = await saved(page)
  expect(original).toEqual(a)
  expect(copied).toMatchObject({ type: 'rectangle', fill: '#ad4033', strokeStyle: 'dashed' })
  await click(page, label.x, label.y)
  await expect(field(page, '填充颜色')).toHaveCount(0)
  await page.getByRole('combobox', { name: '字体', exact: true }).selectOption('SimSun, serif')
  await field(page, '字号').fill('40')
  await field(page, '字号').press('Tab')
  await field(page, '文字颜色').fill('#224477')
  expect((await saved(page))[1]).toMatchObject({ fontFamily: 'SimSun, serif', fontSize: 40, color: '#224477' })
})

test('编辑文字时删除和撤销快捷键不会删除或回退画布图元', async ({ page }) => {
  const a = rect('a', 230, 180)
  await load(page, [a, label])
  await click(page, a.x, a.y)
  await drag(page, [a.x, a.y], [a.x + 65, a.y])
  const changed = await saved(page)
  await click(page, label.x, label.y, true)
  await expect(editor(page)).toBeFocused()
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Delete')
  await page.keyboard.press('Control+z')
  await expect(editor(page)).toBeFocused()
  const result = await saved(page)
  expect(result).toHaveLength(2)
  expect(result[0]).toEqual(changed[0])
})

test('混合选区移动不改变旋转、箭头方向或层叠顺序', async ({ page }) => {
  const a = { ...rect('a', 200, 180), rotation: 28 }
  const b: LineObject = { id: 'b', type: 'arrow', x: 410, y: 255, dx: -120, dy: 0, rotation: -15, stroke: '#355985', strokeWidth: 4 }
  await load(page, [a, b])
  await drag(page, [80, 80], [540, 360])
  await expect(page.getByRole('status')).toHaveText('已选中 2 个对象')
  await drag(page, [a.x, a.y], [a.x + 85, a.y + 65])
  const [first, second] = await saved(page)
  expect(first).toEqual({ ...a, x: first.x, y: first.y })
  expect(second).toEqual({ ...b, x: second.x, y: second.y })
  expect(first.x - a.x).toBeCloseTo(85, -1)
  expect(second.x - b.x).toBeCloseTo(first.x - a.x, 3)
  expect(second.y - b.y).toBeCloseTo(first.y - a.y, 3)
})

test('调色器连续预览不入历史，确认颜色后只撤销一步', async ({ page }) => {
  const a = rect('a', 250, 200)
  await load(page, [a])
  await click(page, a.x, a.y)
  const color = field(page, '填充颜色')
  await color.evaluate((input: HTMLInputElement) => {
    input.value = '#123456'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.value = '#315478'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await expect(button(page, '撤销')).toBeDisabled()
  await color.dispatchEvent('change', { bubbles: true })
  expect(await saved(page)).toEqual([{ ...a, fill: '#315478' }])
  await button(page, '撤销').click()
  expect(await saved(page)).toEqual([a])
  await expect(button(page, '撤销')).toBeDisabled()
})

function inkWidth(page: Page) {
  return stage(page).locator('canvas[data-fabric="main"]').evaluate((canvas: HTMLCanvasElement) => {
    const { width, height } = canvas
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, width, height).data
    let left = width, right = -1
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i] < 128) continue
      const x = (i >> 2) % width
      left = Math.min(left, x)
      right = Math.max(right, x)
    }
    return right < left ? 0 : right - left + 1
  })
}

test('字号输入立刻改变字形，直接保存最新有效值且只记一步', async ({ page }) => {
  await load(page, [label])
  await click(page, label.x, label.y)
  const size = field(page, '字号')
  await expect(size).toBeVisible()
  await expect.poll(() => inkWidth(page)).toBeGreaterThan(0)
  const initial = await inkWidth(page)

  await size.fill('48')
  await expect(size).toBeFocused()
  await expect.poll(() => inkWidth(page)).toBeGreaterThan(initial + 10)
  const larger = await inkWidth(page)
  await size.fill('62')
  await expect.poll(() => inkWidth(page)).toBeGreaterThan(larger + 10)
  const latest = await inkWidth(page)
  for (const invalid of ['', '999']) {
    await size.fill(invalid)
    await expect.poll(() => inkWidth(page)).toBe(latest)
  }
  await expect(size).toBeFocused()
  await expect(button(page, '撤销')).toBeDisabled()

  expect(await saved(page)).toEqual([{ ...label, fontSize: 62 }])
  await button(page, '撤销').click()
  expect(await saved(page)).toEqual([label])
  await expect(button(page, '撤销')).toBeDisabled()
})

test('文字颜色随调色器输入更新画布，调色结束只提交一步', async ({ page }) => {
  await load(page, [label])
  await click(page, label.x, label.y)
  const color = field(page, '文字颜色')
  for (const [value, rgb] of [['#cd171b', [205, 23, 27]], ['#1b5a27', [27, 90, 39]]] as const) {
    await color.evaluate((input: HTMLInputElement, value) => {
      input.value = value
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }, value)
    await expect.poll(() => stage(page).locator('canvas[data-fabric="main"]').evaluate((canvas: HTMLCanvasElement, [r, g, b]) => {
      const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] === r && pixels[i + 1] === g && pixels[i + 2] === b && pixels[i + 3] === 255) return true
      }
      return false
    }, rgb)).toBe(true)
    await expect(button(page, '撤销')).toBeDisabled()
  }
  await color.dispatchEvent('change', { bubbles: true })
  expect(await saved(page)).toEqual([{ ...label, color: '#1b5a27' }])
  await button(page, '撤销').click()
  expect(await saved(page)).toEqual([label])
  await expect(button(page, '撤销')).toBeDisabled()
})

test('字号输入后直接点选另一段文字，变更只提交给原对象', async ({ page }) => {
  const other = { ...label, id: 'other', x: label.x + 260 }
  await load(page, [label, other])
  await click(page, label.x, label.y)
  await field(page, '字号').fill('48')
  await click(page, other.x, other.y)
  await expect(field(page, '字号')).toHaveValue('34')
  expect(await saved(page)).toEqual([{ ...label, fontSize: 48 }, other])
  await button(page, '撤销').click()
  expect(await saved(page)).toEqual([label, other])
  await expect(button(page, '撤销')).toBeDisabled()
})
