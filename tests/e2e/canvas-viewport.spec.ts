import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { decodeProject, encodeProject } from '../../src/project/projectFile'
import type { CanvasScene } from '../../src/core/scene'

const stage = (page: Page) => page.getByTestId('canvas-stage')
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true })
const status = (page: Page) => page.getByRole('status')

async function drag(page: Page, from: [number, number], to: [number, number]) {
  const b = (await stage(page).boundingBox())!
  await page.mouse.move(b.x + b.width * from[0], b.y + b.height * from[1])
  await page.mouse.down()
  await page.mouse.move(b.x + b.width * to[0], b.y + b.height * to[1], { steps: 8 })
  await page.mouse.up()
}

async function save(page: Page) {
  const downloading = page.waitForEvent('download')
  await button(page, '保存项目').click()
  const result = decodeProject(await readFile((await (await downloading).path())!, 'utf8'))
  if (!result.ok) throw new Error(result.message)
  return result.scene
}

async function open(page: Page, scene: CanvasScene) {
  const choosing = page.waitForEvent('filechooser')
  await button(page, '打开项目').click()
  await (await choosing).setFiles({ name: '远处项目.json', mimeType: 'application/json', buffer: Buffer.from(encodeProject(scene)) })
  await expect(page.getByText('远处项目', { exact: true })).toBeVisible()
}

async function clickAt(page: Page, x: number, y: number) {
  const b = (await stage(page).boundingBox())!
  await page.mouse.click(b.x + b.width * x, b.y + b.height * y)
}

test('抓手紧跟选择，不在底栏重复显示，并可切回选择模式', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  const toolbar = page.getByRole('group', { name: '绘图工具', exact: true })
  const tools = toolbar.getByRole('button')
  await expect(tools.nth(0)).toHaveAccessibleName('选择')
  await expect(tools.nth(1)).toHaveAccessibleName('抓手')
  await expect(button(page, '抓手')).toHaveCount(1)
  const [select, hand] = await Promise.all([tools.nth(0).boundingBox(), tools.nth(1).boundingBox()])
  expect(hand!.x).toBeGreaterThan(select!.x)
  expect(hand!.y).toBe(select!.y)

  await tools.nth(1).click()
  await expect(tools.nth(1)).toHaveAttribute('aria-pressed', 'true')
  await expect(tools.nth(0)).toHaveAttribute('aria-pressed', 'false')
  await tools.nth(0).click()
  await expect(tools.nth(1)).toHaveAttribute('aria-pressed', 'false')
  await expect(tools.nth(0)).toHaveAttribute('aria-pressed', 'true')
})

test('在原纸面以外的正负坐标绘制，移动视图不改变已存场景', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  const hand = button(page, '抓手')
  await expect(hand).toBeVisible()
  await hand.click()
  for (let i = 0; i < 3; i++) await drag(page, [.82, .22], [.18, .78])
  await button(page, '矩形').click()
  await drag(page, [.41, .38], [.58, .54])
  const positive = (await save(page)).objects[0]
  expect(positive.x).toBeGreaterThan(1000)
  expect(positive.y).toBeLessThan(0)
  await hand.click()
  for (let i = 0; i < 6; i++) await drag(page, [.18, .78], [.82, .22])
  await button(page, '矩形').click()
  await drag(page, [.41, .38], [.58, .54])
  const before = await save(page)
  expect(before.objects[1].x).toBeLessThan(0)
  const wheelAnchor = (await stage(page).boundingBox())!
  await page.mouse.move(wheelAnchor.x + wheelAnchor.width * .5, wheelAnchor.y + wheelAnchor.height * .5)
  await page.keyboard.down('Control')
  await page.mouse.wheel(0, -140)
  await page.keyboard.up('Control')
  await button(page, '回到内容').click()
  expect(await save(page)).toEqual(before)
  await button(page, '撤销').click()
  expect((await save(page)).objects).toEqual([positive])
})

test('窗口调整保留中心；视图操作不使打开过的项目变脏', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  const scenario = { id: 'workspace', objects: [{ id: 'center', type: 'rectangle', x: 2800, y: -1700,
    width: 160, height: 100, rotation: 0, fill: '#e0eaf3', stroke: '#6381a2', strokeWidth: 2 }] } as const
  await open(page, scenario)
  await button(page, '回到内容').click()
  await clickAt(page, .5, .5)
  await expect(status(page)).toHaveText('已选中 1 个矩形')
  const original = (await stage(page).boundingBox())!
  const splitter = page.getByRole('separator', { name: '调整工作区宽度' })
  const b = (await splitter.boundingBox())!
  await page.mouse.move(b.x + b.width / 2, b.y + b.height * .45)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width / 2 + 130, b.y + b.height * .45, { steps: 6 })
  await page.mouse.up()
  await expect.poll(async () => (await stage(page).boundingBox())!.width).toBeLessThan(original.width - 90)
  await clickAt(page, .5, .5)
  await expect(status(page)).toHaveText('已选中 1 个矩形')
  await button(page, '收起侧栏').click()
  await expect.poll(async () => (await stage(page).boundingBox())!.width).toBeGreaterThan(original.width)
  await clickAt(page, .5, .5)
  await expect(status(page)).toHaveText('已选中 1 个矩形')
  await button(page, '展开侧栏').click()
  await expect(button(page, '撤销')).toBeDisabled()
  const dialogs: string[] = []
  page.on('dialog', dialog => { dialogs.push(dialog.message()); return dialog.dismiss() })
  await button(page, '新建').click()
  await expect(page.getByText('从一张空白画布开始')).toBeVisible()
  expect(dialogs).toEqual([])
})

test('文字输入中的空格和画布上的临时抓手可区分', async ({ page }) => {
  await page.goto('/')
  await expect(button(page, '抓手')).toBeVisible()
  await button(page, '文字').click()
  await clickAt(page, .52, .53)
  const textarea = page.locator('textarea[data-fabric="textarea"]')
  await expect(textarea).toBeFocused()
  await page.keyboard.insertText('中文')
  await page.keyboard.press('Space')
  await page.keyboard.insertText('空格')
  await expect(textarea).toHaveValue('中文 空格')
  await clickAt(page, .10, .85)
  const before = await save(page)
  await clickAt(page, .10, .85) // Focus the canvas, not the file button (Space activates focused buttons).
  await page.keyboard.down('Space')
  try { await drag(page, [.52, .53], [.17, .25]) } finally { await page.keyboard.up('Space') }
  const after = await save(page)
  expect(after).toEqual(before)
  await expect(button(page, '选择')).toHaveAttribute('aria-pressed', 'true')
})

test('全屏开合不改项目，2× 像素比下仍可从窗口中心点选', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 })
  try {
    const page = await context.newPage()
    await page.goto('/')
    const scene = { id: 'high-dpi', objects: [{ id: 'center', type: 'rectangle', x: -2500, y: 3300,
      width: 150, height: 75, rotation: 0, fill: '#e0eaf3', stroke: '#6381a2', strokeWidth: 2 }] } as const
    await open(page, scene)
    await button(page, '回到内容').click()
    await button(page, '全屏').click()
    await expect(button(page, '退出全屏')).toBeVisible()
    await clickAt(page, .5, .5)
    await expect(status(page)).toHaveText('已选中 1 个矩形')
    await button(page, '退出全屏').click()
    await expect(button(page, '全屏')).toBeVisible()
    await expect(button(page, '撤销')).toBeDisabled()
    expect(await save(page)).toEqual(scene)
  } finally {
    await context.close()
  }
})
