import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { decodeProject, encodeProject } from '../../src/project/projectFile'

const tool = (page: Page, name: string) => page.getByRole('button', { name, exact: true })
const stage = (page: Page) => page.getByTestId('canvas-stage')
const sidebar = (page: Page) => page.getByRole('complementary', { name: '项目侧栏' })

async function point(page: Page, x: number, y: number) {
  const box = (await stage(page).boundingBox())!
  return { x: box.x + box.width * x, y: box.y + box.height * y }
}

async function clickAt(page: Page, x: number, y: number, twice = false) {
  const p = await point(page, x, y)
  if (twice) await page.mouse.dblclick(p.x, p.y)
  else await page.mouse.click(p.x, p.y)
}

const textInput = (page: Page) => page.locator('textarea[data-fabric="textarea"]')

function alphaAt(page: Page, x: number, y: number) {
  return stage(page).locator('canvas[data-fabric="main"]').evaluate((canvas: HTMLCanvasElement, [x, y]) =>
    canvas.getContext('2d')!.getImageData(Math.floor(canvas.width * x), Math.floor(canvas.height * y), 1, 1).data[3], [x, y])
}

async function drag(page: Page, from: [number, number], to: [number, number]) {
  const start = await point(page, ...from)
  const end = await point(page, ...to)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 10 })
  await page.mouse.up()
}

test('从空白首页反向拖出一个矩形，一次撤销即可移除', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('从一张空白画布开始')).toBeVisible()
  await expect(tool(page, '撤销')).toBeDisabled()
  await tool(page, '矩形').click()
  await drag(page, [.39, .40], [.20, .22])
  await expect(sidebar(page).getByText('1 个对象', { exact: true })).toBeVisible()
  await expect(tool(page, '选择')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('已选中 1 个矩形', { exact: true })).toBeVisible()
  await tool(page, '撤销').click()
  await expect(page.getByText('从一张空白画布开始')).toBeVisible()
  await expect(tool(page, '撤销')).toBeDisabled()
  await tool(page, '重做').click()
  await expect(sidebar(page).getByText('1 个对象', { exact: true })).toBeVisible()
})

test('在原位置编辑中文，结束编辑后只增加一步历史', async ({ page }) => {
  await page.goto('/')
  await tool(page, '文字').click()
  await clickAt(page, .55, .48)
  await expect(textInput(page)).toBeFocused()
  await page.keyboard.insertText('帧数与预算\n中文说明')
  await expect(tool(page, '撤销')).toBeDisabled()
  await clickAt(page, .08, .85)
  await expect(sidebar(page).getByText('1 个对象', { exact: true })).toBeVisible()

  await clickAt(page, .55, .48, true)
  await expect(textInput(page)).toBeFocused()
  await expect(textInput(page)).toHaveValue('帧数与预算\n中文说明')
  await page.keyboard.press('Control+a')
  await page.keyboard.insertText('修改后的中文')
  await clickAt(page, .08, .85)
  await tool(page, '撤销').click()
  await clickAt(page, .55, .48, true)
  await expect(textInput(page)).toHaveValue('帧数与预算\n中文说明')
  await clickAt(page, .08, .85)
  await tool(page, '撤销').click()
  await expect(sidebar(page).getByText('0 个对象', { exact: true })).toBeVisible()
})

test('矩形移动和缩放各占一步历史，回放会刷新画布', async ({ page }) => {
  await page.goto('/')
  await tool(page, '矩形').click()
  await drag(page, [.20, .22], [.40, .40])
  await expect.poll(() => alphaAt(page, .30, .31)).toBe(255)
  await drag(page, [.30, .31], [.55, .41])
  await expect.poll(() => alphaAt(page, .55, .41)).toBe(255)
  await expect.poll(() => alphaAt(page, .30, .31)).toBe(0)
  await drag(page, [.65, .41], [.78, .41])
  await expect.poll(() => alphaAt(page, .73, .41)).toBe(255)

  await tool(page, '撤销').click()
  await expect.poll(() => alphaAt(page, .73, .41)).toBe(0)
  await expect.poll(() => alphaAt(page, .55, .41)).toBe(255)
  await tool(page, '撤销').click()
  await expect.poll(() => alphaAt(page, .30, .31)).toBe(255)
  await tool(page, '撤销').click()
  await expect(tool(page, '撤销')).toBeDisabled()
  await tool(page, '重做').click()
  await tool(page, '重做').click()
  await tool(page, '重做').click()
  await expect.poll(() => alphaAt(page, .73, .41)).toBe(255)
})

async function downloadProject(page: Page) {
  const downloading = page.waitForEvent('download')
  await tool(page, '保存项目').click()
  const download = await downloading
  const file = { name: download.suggestedFilename(), mimeType: 'application/json', buffer: await readFile((await download.path())!) }
  const result = decodeProject(file.buffer.toString('utf8'))
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.message)
  return { download, file, scene: result.scene }
}

async function openFile(page: Page, file: { name: string; mimeType: string; buffer: Buffer }) {
  const choosing = page.waitForEvent('filechooser')
  await tool(page, '打开项目').click()
  await (await choosing).setFiles(file)
}

test('实际下载后在新会话重开，继续编辑只改原文字内容', async ({ page, browser }, testInfo) => {
  await page.goto('/')
  await expect(tool(page, '保存项目')).toBeEnabled()
  await tool(page, '矩形').click()
  await drag(page, [.20, .22], [.40, .40])
  await drag(page, [.30, .31], [.55, .41])
  await drag(page, [.65, .41], [.78, .41])
  await tool(page, '文字').click()
  await clickAt(page, .42, .64)
  await expect(textInput(page)).toBeFocused()
  await page.keyboard.insertText('帧数增加 & 预算不变\n继续编辑')
  // 保存会结束已确认的文字编辑，不要求先点击空白处。
  const saved = await downloadProject(page)
  expect(JSON.parse(saved.file.buffer.toString('utf8'))).toEqual({ format: 'document-vector-canvas', version: 2, scene: saved.scene })
  const [rectangle, text] = saved.scene.objects
  expect(rectangle).toMatchObject({ type: 'rectangle', rotation: 0 })
  expect(rectangle.x).toBeGreaterThan(550)
  if (rectangle.type !== 'rectangle') throw new Error('缺少矩形')
  expect(rectangle.width).toBeGreaterThan(310)
  expect(text).toMatchObject({ type: 'text', text: '帧数增加 & 预算不变\n继续编辑' })
  await saved.download.saveAs(testInfo.outputPath('personal-v2.json'))

  const fresh = await browser.newContext()
  try {
    const reopened = await fresh.newPage()
    await reopened.goto('/')
    await openFile(reopened, saved.file)
    await expect(sidebar(reopened).getByText('2 个对象', { exact: true })).toBeVisible()
    await expect(tool(reopened, '撤销')).toBeDisabled()
    await expect.poll(() => alphaAt(reopened, .73, .41)).toBe(255)
    await clickAt(reopened, .42, .64, true)
    await expect(textInput(reopened)).toHaveValue('帧数增加 & 预算不变\n继续编辑')
    await reopened.keyboard.press('Control+a')
    await reopened.keyboard.insertText('重开后修改')
    const modified = await downloadProject(reopened)
    expect(modified.scene).toEqual({ id: saved.scene.id, objects: [rectangle, { ...text, text: '重开后修改' }] })
    await modified.download.saveAs(testInfo.outputPath('personal-reopened-v2.json'))
  } finally {
    await fresh.close()
  }
})

test('在正式页面打开 C3 下载件并无损保存为 v2', async ({ page }) => {
  await page.goto('/')
  const legacy = await readFile(new URL('../fixtures/projects/personal-v1.json', import.meta.url))
  await openFile(page, { name: 'C3项目.json', mimeType: 'application/json', buffer: legacy })
  await expect(sidebar(page).getByText('6 个对象', { exact: true })).toBeVisible()
  await expect(tool(page, '撤销')).toBeDisabled()
  const saved = await downloadProject(page)
  expect(JSON.parse(saved.file.buffer.toString('utf8'))).toEqual({ ...JSON.parse(legacy.toString('utf8')), version: 2 })
})

test('坏文件和取消打开保留画布与历史，成功打开才重置历史', async ({ page }) => {
  await page.goto('/')
  await expect(tool(page, '打开项目')).toBeEnabled()
  const file = (buffer: string) => ({ name: '替换项目.json', mimeType: 'application/json', buffer: Buffer.from(buffer) })
  await tool(page, '矩形').click()
  await drag(page, [.20, .22], [.40, .40])
  const original = await downloadProject(page)
  await drag(page, [.30, .31], [.55, .41])
  const choosing = page.waitForEvent('filechooser')
  await tool(page, '打开项目').click()
  // Playwright 不操作系统文件对话框；用 HTML 原生 cancel 事件覆盖返回页面后的分支。
  await (await choosing).element().dispatchEvent('cancel')
  await expect.poll(() => alphaAt(page, .55, .41)).toBe(255)
  const beforeError = await stage(page).boundingBox()
  await openFile(page, file('{'))
  await expect(page.getByRole('alert')).toContainText('当前画布未更改')
  expect(await stage(page).boundingBox()).toEqual(beforeError)
  await tool(page, '撤销').click()
  await expect.poll(() => alphaAt(page, .30, .31)).toBe(255)
  await expect(tool(page, '重做')).toBeEnabled()
  await tool(page, '重做').click()
  await expect.poll(() => alphaAt(page, .55, .41)).toBe(255)

  const replacement = file(encodeProject({ id: 'replacement', objects: original.scene.objects }))
  page.once('dialog', dialog => dialog.dismiss())
  await openFile(page, replacement)
  await expect.poll(() => alphaAt(page, .55, .41)).toBe(255)
  await expect(tool(page, '撤销')).toBeEnabled()
  await drag(page, [.55, .41], [.60, .48])
  await tool(page, '撤销').click()
  await expect(tool(page, '撤销')).toBeEnabled()
  await expect(tool(page, '重做')).toBeEnabled()
  page.once('dialog', dialog => dialog.accept())
  await openFile(page, replacement)
  await expect(sidebar(page).getByText('替换项目', { exact: true })).toBeVisible()
  await expect.poll(() => alphaAt(page, .30, .31)).toBe(255)
  await expect(tool(page, '撤销')).toBeDisabled()
  await expect(tool(page, '重做')).toBeDisabled()
})

test('新建前确认是否丢弃改动，取消不会清空当前画布', async ({ page }) => {
  await page.goto('/')
  await tool(page, '矩形').click()
  await drag(page, [.20, .22], [.40, .40])
  await expect(tool(page, '新建')).toBeEnabled()
  page.once('dialog', dialog => dialog.dismiss())
  await tool(page, '新建').click()
  await expect.poll(() => alphaAt(page, .30, .31)).toBe(255)
  await expect(tool(page, '撤销')).toBeEnabled()
  page.once('dialog', dialog => dialog.accept())
  await tool(page, '新建').click()
  await expect(page.getByText('从一张空白画布开始')).toBeVisible()
  await expect(tool(page, '撤销')).toBeDisabled()
})

test('浏览器合成输入不会把未确认的拼音写入画布历史', async ({ page, context }) => {
  await page.goto('/')
  await tool(page, '文字').click()
  await clickAt(page, .55, .48)
  await expect(textInput(page)).toBeFocused()
  await page.keyboard.insertText('原文')
  const cdp = await context.newCDPSession(page)
  try {
    await cdp.send('Input.imeSetComposition', { text: 'zhongwen', selectionStart: 8, selectionEnd: 8 })
    await expect(textInput(page)).toHaveValue('原文zhongwen')
    await expect(tool(page, '撤销')).toBeDisabled()
    await cdp.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 })
    await expect(textInput(page)).toHaveValue('原文')
    await expect(tool(page, '撤销')).toBeDisabled()
    await cdp.send('Input.imeSetComposition', { text: 'zhongwen', selectionStart: 8, selectionEnd: 8 })
    await cdp.send('Input.insertText', { text: '中文' })
    await expect(textInput(page)).toHaveValue('原文中文')
    await expect(tool(page, '撤销')).toBeDisabled()
  } finally {
    await cdp.detach()
  }
  const { scene } = await downloadProject(page)
  expect(scene.objects).toEqual([expect.objectContaining({ type: 'text', text: '原文中文' })])
  await tool(page, '撤销').click()
  await expect(tool(page, '撤销')).toBeDisabled()
})

test('收起侧栏与切换主题只改变视图，不改变保存的图元或历史', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await expect(page.locator('.space')).toHaveCSS('background-image', /radial-gradient/)
  await tool(page, '矩形').click()
  await drag(page, [.20, .22], [.40, .40])
  const saved = await downloadProject(page)
  const initial = (await stage(page).boundingBox())!
  await tool(page, '暗色').click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('.space')).toHaveCSS('background-image', 'none')
  await expect.poll(() => alphaAt(page, .30, .31)).toBe(255)
  await tool(page, '收起侧栏').click()
  await expect.poll(async () => (await stage(page).boundingBox())!.width).toBeGreaterThan(initial.width)
  await expect.poll(() => alphaAt(page, .30, .31)).toBe(255)
  await expect(tool(page, '撤销')).toBeEnabled()
  await tool(page, '展开侧栏').click()
  expect((await downloadProject(page)).scene).toEqual(saved.scene)
  await tool(page, '撤销').click()
  await expect(tool(page, '撤销')).toBeDisabled()
})

test('异步打开期间尚未完成的旧拖拽不能写入新项目', async ({ page }) => {
  await page.addInitScript(() => {
    // 仅人工控制读取完成的时机，仍由浏览器读取实际选中的文件。
    const arrayBuffer = File.prototype.arrayBuffer
    const waitForRelease = () => new Promise<void>(resolve => window.addEventListener('release-file-read', () => resolve(), { once: true }))
    File.prototype.arrayBuffer = async function () { await waitForRelease(); return arrayBuffer.call(this) }
  })
  await page.goto('/')
  await openFile(page, { name: '新会话.json', mimeType: 'application/json', buffer: Buffer.from(encodeProject({ id: 'new-session', objects: [] })) })
  await expect(tool(page, '打开项目')).toBeDisabled()
  await tool(page, '矩形').click()
  const a = await point(page, .2, .2)
  const b = await point(page, .4, .4)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move(b.x, b.y, { steps: 3 })
  await page.evaluate(() => window.dispatchEvent(new Event('release-file-read')))
  await expect(sidebar(page).getByText('新会话', { exact: true })).toBeVisible()
  await page.mouse.up()
  await expect(tool(page, '撤销')).toBeDisabled()
  expect((await downloadProject(page)).scene).toEqual({ id: 'new-session', objects: [] })
})

test('矩形拖出窗口后仍能重开并通过回到内容找回', async ({ page }) => {
  await page.goto('/')
  await tool(page, '矩形').click()
  await drag(page, [.20, .22], [.40, .40])
  await drag(page, [.30, .31], [-.35, .31])
  const saved = await downloadProject(page)
  expect(saved.scene.objects[0].x).toBeLessThan(0)
  await page.reload()
  await openFile(page, saved.file)
  await expect(sidebar(page).getByText('1 个对象', { exact: true })).toBeVisible()
  await tool(page, '回到内容').click()
  await expect.poll(() => alphaAt(page, .5, .5)).toBe(255)
  await clickAt(page, .5, .5)
  await expect(page.getByRole('status')).toHaveText('已选中 1 个矩形')
})

function textBounds(page: Page) {
  return stage(page).locator('canvas[data-fabric="main"]').evaluate((canvas: HTMLCanvasElement) => {
    const { width, height } = canvas
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, width, height).data
    let left = width, top = height, right = -1, bottom = -1
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * 4 + 3] < 128) continue
      left = Math.min(left, x); top = Math.min(top, y)
      right = Math.max(right, x); bottom = Math.max(bottom, y)
    }
    return [left, top, right, bottom]
  })
}

test('文字加宽和换行时，所见位置与提交后的位置一致', async ({ page }) => {
  await page.goto('/')
  await tool(page, '文字').click()
  await clickAt(page, .50, .48)
  await expect(textInput(page)).toBeFocused()
  await page.keyboard.insertText('中')
  await clickAt(page, .08, .85)
  await clickAt(page, .50, .48, true)
  await expect(textInput(page)).toBeFocused()
  await page.keyboard.press('Control+a')
  await page.keyboard.insertText('较长的图注说明\n中英文 & 并排')
  await expect.poll(async () => {
    const [left, top, right, bottom] = await textBounds(page)
    return right - left > 100 && bottom - top > 28
  }).toBe(true)
  const before = await textBounds(page)
  await clickAt(page, .08, .85)
  await expect(textInput(page)).toHaveCount(0)
  // 离开编辑会恢复 Fabric 的对象缓存，抗锯齿可能造成数像素的边缘差异。
  await expect.poll(async () => Math.max(...(await textBounds(page)).map((after, i) => Math.abs(after - before[i])))).toBeLessThanOrEqual(4)
})

test('保存时仍未确认的输入法候选不进入下载文件', async ({ page, context }) => {
  await page.goto('/')
  await tool(page, '文字').click()
  await clickAt(page, .5, .48)
  await expect(textInput(page)).toBeFocused()
  await page.keyboard.insertText('原文')
  const cdp = await context.newCDPSession(page)
  try {
    await cdp.send('Input.imeSetComposition', { text: 'zhongwen', selectionStart: 8, selectionEnd: 8 })
    await expect(textInput(page)).toHaveValue('原文zhongwen')
    expect((await downloadProject(page)).scene.objects).toEqual([expect.objectContaining({ type: 'text', text: '原文' })])
  } finally {
    await cdp.detach()
  }
})

test('文本字段含非法 UTF-8 的项目不会替换当前画布', async ({ page }) => {
  await page.goto('/')
  await tool(page, '矩形').click()
  await drag(page, [.20, .22], [.40, .40])
  await downloadProject(page)
  const valid = encodeProject({ id: 'invalid-bytes', objects: [{ id: 't', type: 'text', text: '__BAD__',
    x: 80, y: 80, rotation: 0, fontFamily: 'sans-serif', fontSize: 28, color: '#343e4e' }] })
  const [prefix, suffix] = valid.split('__BAD__')
  await openFile(page, { name: '坏字节.json', mimeType: 'application/json', buffer: Buffer.concat([Buffer.from(prefix), Buffer.from([0xff]), Buffer.from(suffix)]) })
  await expect(page.getByRole('alert')).toContainText('当前画布未更改')
  await expect.poll(() => alphaAt(page, .30, .31)).toBe(255)
  await expect(tool(page, '撤销')).toBeEnabled()
})
