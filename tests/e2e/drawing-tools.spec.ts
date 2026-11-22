import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { decodeProject } from '../../src/project/projectFile'

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true })
type Point = [number, number]

async function gesture(page: Page, points: Point[]) {
  const box = (await page.getByTestId('canvas-stage').boundingBox())!
  const move = (p: Point) => page.mouse.move(box.x + p[0] * box.width, box.y + p[1] * box.height, { steps: 5 })
  await move(points[0])
  await page.mouse.down()
  for (const p of points.slice(1)) await move(p)
  await page.mouse.up()
}

async function download(page: Page) {
  const pending = page.waitForEvent('download')
  await button(page, '保存项目').click()
  const downloaded = await pending
  const buffer = await readFile((await downloaded.path())!)
  const result = decodeProject(buffer.toString('utf8'))
  if (!result.ok) throw new Error(result.message)
  return { scene: result.scene, buffer, name: downloaded.suggestedFilename() }
}

async function openProject(page: Page, file: Awaited<ReturnType<typeof download>>) {
  const choosing = page.waitForEvent('filechooser')
  await button(page, '打开项目').click()
  await (await choosing).setFiles({ name: file.name, mimeType: 'application/json', buffer: file.buffer })
}

test('椭圆反向绘制，直线和箭头保留方向；重开后能从画布选中', async ({ page, browser }) => {
  await page.goto('/')
  const inputs: [string, Point[]][] = [
    ['椭圆', [[.34, .44], [.18, .18]]],
    ['直线', [[.40, .41], [.66, .41]]],
    ['箭头', [[.76, .68], [.42, .68]]],
  ]
  for (const [name, points] of inputs) {
    await button(page, name).click()
    await gesture(page, points)
    await expect(button(page, '选择')).toHaveAttribute('aria-pressed', 'true')
  }
  const saved = await download(page)
  expect(saved.scene.objects).toEqual([
    expect.objectContaining({ type: 'ellipse', width: expect.any(Number), height: expect.any(Number) }),
    expect.objectContaining({ type: 'line', dx: expect.any(Number), dy: 0 }),
    expect.objectContaining({ type: 'arrow', dx: expect.any(Number), dy: 0 }),
  ])
  const [, line, arrow] = saved.scene.objects
  if (line.type !== 'line' || arrow.type !== 'arrow') throw new Error('缺少有向图元')
  expect(line.dx).toBeGreaterThan(0)
  expect(arrow.dx).toBeLessThan(0)

  const context = await browser.newContext()
  try {
    const reopened = await context.newPage()
    await reopened.goto('/')
    await openProject(reopened, saved)
    await expect(reopened.getByRole('list', { name: '画布对象' }).getByRole('listitem')).toHaveCount(3)
    for (const [label, x, y] of [['椭圆', .26, .30], ['直线', .53, .419], ['箭头', .61, .68]] as const) {
      const box = (await reopened.getByTestId('canvas-stage').boundingBox())!
      await reopened.mouse.click(box.x + x * box.width, box.y + y * box.height)
      await expect(reopened.getByRole('status')).toHaveText(`已选中 1 个${label}`)
    }
    expect((await download(reopened)).scene).toEqual(saved.scene)
  } finally {
    await context.close()
  }
})

test('画笔每笔单独存储并支持单步撤销，零长度不写历史', async ({ page }) => {
  await page.goto('/')
  for (const name of ['直线', '椭圆', '箭头', '画笔']) {
    await button(page, name).click()
    await gesture(page, [[.18, .26]])
    await expect(button(page, '撤销')).toBeDisabled()
  }
  await gesture(page, [[.20, .39], [.27, .29], [.38, .39]])
  await expect(button(page, '画笔')).toHaveAttribute('aria-pressed', 'true')
  await gesture(page, [[.42, .53], [.55, .67], [.70, .53]])
  const saved = await download(page)
  expect(saved.scene.objects.map(object => object.type)).toEqual(['stroke', 'stroke'])
  for (const object of saved.scene.objects) {
    if (object.type !== 'stroke') throw new Error('缺少笔迹')
    expect(object.points.length).toBeGreaterThan(2)
  }
  await button(page, '撤销').click()
  expect((await download(page)).scene.objects).toEqual(saved.scene.objects.slice(0, 1))
  await button(page, '重做').click()
  expect((await download(page)).scene).toEqual(saved.scene)
  await page.reload()
  await openProject(page, saved)
  await expect(page.getByRole('list', { name: '画布对象' }).getByRole('listitem')).toHaveCount(2)
  const box = (await page.getByTestId('canvas-stage').boundingBox())!
  await page.mouse.click(box.x + .55 * box.width, box.y + .67 * box.height)
  await expect(page.getByRole('status')).toHaveText('已选中 1 个笔迹')
})
