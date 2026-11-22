import { expect, test, type Page } from '@playwright/test'
import type { CanvasObject } from '../../src/core/scene'
import { encodeProject } from '../../src/project/projectFile'
import { initialScenePoint } from './initial-scene-point'

const item = (page: Page, name: string) => page.getByRole('button', { name, exact: true })
const status = (page: Page) => page.getByRole('status')
const style = { stroke: '#355985', strokeWidth: 3, rotation: 0 }
const objects: CanvasObject[] = [
  { ...style, type: 'rectangle', id: 'r1', x: 120, y: 150, width: 90, height: 45, fill: '#e0eaf3' },
  { ...style, type: 'rectangle', id: 'r2', x: 330, y: 215, width: 130, height: 60, fill: '#ffe4c8' },
  { ...style, type: 'rectangle', id: 'r3', x: 4800, y: -3200, width: 200, height: 90, fill: '#efe4f7' },
  { ...style, type: 'line', id: 'l1', x: 410, y: 400, dx: 100, dy: 25 },
  { ...style, type: 'arrow', id: 'a1', x: 670, y: 260, dx: 120, dy: -25 },
]

async function openProject(page: Page, objects: CanvasObject[]) {
  await page.goto('/')
  const choosing = page.waitForEvent('filechooser')
  await item(page, '打开项目').click()
  await (await choosing).setFiles({ name: '图元目录.json', mimeType: 'application/json', buffer: Buffer.from(encodeProject({ id: 'navigator', objects })) })
  await expect(page.getByText('图元目录', { exact: true })).toBeVisible()
}

test('对象分组独立展开，可整组选中并用 Shift 增减个别条目', async ({ page }) => {
  await openProject(page, objects)
  const group = item(page, '选中全部矩形')
  const toggle = item(page, '折叠矩形分组')
  await expect(toggle).toBeVisible()
  await expect(status(page)).toHaveText('5 个对象')
  await group.click()
  await expect(status(page)).toHaveText('已选中 3 个对象')
  await expect(group).toHaveAttribute('aria-pressed', 'true')
  await expect(item(page, '选中直线 1')).toHaveAttribute('aria-pressed', 'false')
  await toggle.click()
  await expect(status(page)).toHaveText('已选中 3 个对象')
  await expect(item(page, '选中矩形 2')).toBeHidden()
  await item(page, '展开矩形分组').click()
  const second = item(page, '选中矩形 2')
  await expect(second).toHaveAttribute('aria-pressed', 'true')
  await second.click({ modifiers: ['Shift'] })
  await expect(status(page)).toHaveText('已选中 2 个对象')
  await expect(group).toHaveAttribute('aria-pressed', 'mixed')
  await second.click({ modifiers: ['Shift'] })
  await expect(group).toHaveAttribute('aria-pressed', 'true')
  await second.click()
  await expect(status(page)).toHaveText('已选中 1 个矩形')
  await expect(page.getByText('130 × 60', { exact: true })).toBeVisible()
  await expect(page.getByLabel('填充颜色', { exact: true })).toHaveValue('#ffe4c8')
  await expect(item(page, '撤销')).toBeDisabled()
})

test('定位视口外对象、画布选区、删除与撤销均与目录同步', async ({ page }) => {
  await openProject(page, objects)
  const from = await initialScenePoint(page, 40, 80), to = await initialScenePoint(page, 410, 280)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 7 })
  await page.mouse.up()
  await expect(item(page, '选中矩形 1')).toHaveAttribute('aria-pressed', 'true')
  await expect(item(page, '选中矩形 2')).toHaveAttribute('aria-pressed', 'true')
  await expect(item(page, '选中矩形 3')).toHaveAttribute('aria-pressed', 'false')

  await item(page, '定位矩形 3').click()
  await expect(status(page)).toHaveText('已选中 1 个矩形')
  await expect(page.getByText('4800, -3200', { exact: true })).toBeVisible()
  const canvas = page.getByTestId('canvas-stage')
  await canvas.click({ position: { x: 20, y: 30 } })
  await expect(item(page, '选中矩形 3')).toHaveAttribute('aria-pressed', 'false')
  const b = (await canvas.boundingBox())!
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2)
  await expect(item(page, '选中矩形 3')).toHaveAttribute('aria-pressed', 'true')
  await item(page, '删除').click()
  await expect(item(page, '选中矩形 3')).toHaveCount(0)
  await item(page, '撤销').click()
  await expect(item(page, '选中矩形 3')).toBeVisible()
  await expect(item(page, '撤销')).toBeDisabled()
})

test('长目录独立滚动，底栏仍在可视窗口内', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await openProject(page, Array.from({ length: 45 }, (_, index) => ({ ...objects[0], id: `r-${index}`, x: index * 130 })))
  await item(page, '定位矩形 45').click()
  await expect(item(page, '选中矩形 45')).toHaveAttribute('aria-pressed', 'true')
  const viewport = await page.evaluate(() => ({ scroll: document.documentElement.scrollTop, bottom: document.querySelector('.statusbar')!.getBoundingClientRect().bottom, height: window.innerHeight }))
  expect(viewport.scroll).toBe(0)
  expect(viewport.bottom).toBeLessThanOrEqual(viewport.height)
  await expect(item(page, '保存项目')).toBeInViewport()
  await expect(page.getByRole('heading', { name: '对象属性' })).toBeInViewport()
})
