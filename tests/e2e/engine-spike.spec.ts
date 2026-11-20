import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'

const spike = '/spike.html'
const stage = (page: Page) => page.getByTestId('stage')
const count = (page: Page) => page.getByRole('status', { name: '提交次数' })
const state = async (page: Page) => JSON.parse((await page.getByTestId('scene-state').textContent())!)

function surfacePixel(page: Page, x: number, y: number) {
  return page.locator('#canvas').evaluate((surface: HTMLCanvasElement, point) => {
    const bounds = surface.getBoundingClientRect()
    const px = Math.round(point.x * surface.width / bounds.width)
    const py = Math.round(point.y * surface.height / bounds.height)
    return Array.from(surface.getContext('2d')!.getImageData(px, py, 1, 1).data)
  }, { x, y })
}

async function dragRectangle(page: Page, zoom = 1) {
  const bounds = (await stage(page).boundingBox())!
  const x = bounds.x + 24 + 120 * zoom
  const y = bounds.y + 16 + 92 * zoom
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 44 * zoom, y + 30 * zoom, { steps: 10 })
  await expect(count(page)).toHaveText('0')
  await page.mouse.up()
}

test('拖拽、按 ID 改色各提交一次，回放不重复提交', async ({ page }) => {
  await page.goto(spike)
  await expect(count(page)).toHaveText('0')
  await dragRectangle(page)
  await expect(count(page)).toHaveText('1')
  expect((await state(page)).rectangle).toMatchObject({ x: 164, y: 122, fill: '#0f766e' })

  await page.getByRole('button', { name: '按 ID 改色' }).click()
  await expect(count(page)).toHaveText('2')
  expect((await state(page)).rectangle).toMatchObject({ x: 164, y: 122, fill: '#b45309' })
  await expect.poll(() => surfacePixel(page, 24 + 164, 16 + 122)).toEqual([180, 83, 9, 255])

  await page.getByRole('button', { name: '撤销最近修改' }).click()
  await expect(count(page)).toHaveText('2')
  expect((await state(page)).rectangle).toMatchObject({ x: 164, y: 122, fill: '#0f766e' })
  await page.getByRole('button', { name: '撤销最近修改' }).click()
  await expect(count(page)).toHaveText('2')
  expect((await state(page)).rectangle).toMatchObject({ x: 120, y: 92, fill: '#0f766e' })
  await expect(page.getByRole('button', { name: '撤销最近修改' })).toBeDisabled()
})

async function markerPixel(page: Page) {
  return page.getByTestId('reference-marker').evaluate((marker) => {
    const target = marker.getBoundingClientRect()
    const surface = document.querySelector<HTMLCanvasElement>('#canvas')!
    const bounds = surface.getBoundingClientRect()
    const x = Math.round((target.x + target.width / 2 - bounds.x) * surface.width / bounds.width)
    const y = Math.round((target.y + target.height / 2 - bounds.y) * surface.height / bounds.height)
    return Array.from(surface.getContext('2d')!.getImageData(x, y, 1, 1).data)
  })
}

for (const dpr of [1, 2]) {
  test(`在设备像素比 ${dpr} 下缩放和平移后仍对准底图，拖拽写入场景坐标`, async ({ browser }) => {
    const context = await browser.newContext({ deviceScaleFactor: dpr, viewport: { width: 1060, height: 840 } })
    try {
      const page = await context.newPage()
      await page.goto(spike)
      for (const zoom of ['0.5', '1', '2']) {
        await page.getByRole('combobox', { name: '画布缩放' }).selectOption(zoom)
        const box = (await stage(page).boundingBox())!
        const anchor = (await page.getByTestId('reference-marker').boundingBox())!
        expect(anchor.x + anchor.width / 2 - box.x).toBeCloseTo(24 + 120 * Number(zoom))
        expect(anchor.y + anchor.height / 2 - box.y).toBeCloseTo(16 + 92 * Number(zoom))
        await expect.poll(() => markerPixel(page)).toEqual([15, 118, 110, 255])
      }
      await page.getByRole('button', { name: '平移视口' }).click()
      const box = (await stage(page).boundingBox())!
      const anchor = (await page.getByTestId('reference-marker').boundingBox())!
      expect(anchor.x + anchor.width / 2 - box.x).toBeCloseTo(48 + 120 * 2)
      expect(anchor.y + anchor.height / 2 - box.y).toBeCloseTo(32 + 92 * 2)
      await expect.poll(() => markerPixel(page)).toEqual([15, 118, 110, 255])
      await expect(count(page)).toHaveText('0')
      await page.getByRole('button', { name: '平移视口' }).click()
      await dragRectangle(page, 2)
      await expect(count(page)).toHaveText('1')
      expect((await state(page)).rectangle).toMatchObject({ x: 164, y: 122 })
    } finally {
      await context.close()
    }
  })
}

test('中文文本通过真实控件编辑并随本地文件在新会话重开', async ({ page, browser }) => {
  await page.goto(spike)
  await expect(page.getByRole('button', { name: '保存小样' })).toBeEnabled()
  await dragRectangle(page)
  await expect(count(page)).toHaveText('1')

  const box = (await stage(page).boundingBox())!
  await page.mouse.dblclick(box.x + 24 + 225, box.y + 16 + 165)
  await expect(page.locator('textarea[data-fabric="textarea"]')).toBeFocused()
  await page.keyboard.press('Control+a')
  await page.keyboard.insertText('帧数增加 & 预算不变\n继续编辑')
  await expect(count(page)).toHaveText('1')
  await page.mouse.click(box.x + 10, box.y + 440)
  await expect(count(page)).toHaveText('2')

  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: '保存小样' }).click()
  const downloaded = await downloading
  const file = await readFile((await downloaded.path())!)
  const project = JSON.parse(file.toString('utf8'))
  expect(project.version).toBe(1)
  expect(project.scene.rectangle).toMatchObject({ id: 'rect-1', x: 164, y: 122 })
  expect(project.scene.text).toMatchObject({ id: 'text-1', value: '帧数增加 & 预算不变\n继续编辑' })

  const fresh = await browser.newContext()
  try {
    const reopened = await fresh.newPage()
    await reopened.goto(spike)
    await reopened.getByLabel('打开小样').setInputFiles({ name: downloaded.suggestedFilename(), mimeType: 'application/json', buffer: file })
    await expect(reopened.getByRole('status', { name: '文件状态' })).toHaveText('已打开小样')
    expect(await state(reopened)).toEqual(project.scene)
    await expect(count(reopened)).toHaveText('0')
    await reopened.getByRole('button', { name: '按 ID 改色' }).click()
    await expect(count(reopened)).toHaveText('1')
    expect((await state(reopened)).rectangle).toMatchObject({ id: 'rect-1', x: 164, y: 122, fill: '#b45309' })
    await reopened.getByLabel('打开小样').setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{') })
    await expect(reopened.getByRole('status', { name: '文件状态' })).toHaveText('打开失败，当前小样未变更')
    expect((await state(reopened)).rectangle.fill).toBe('#b45309')
    await expect(count(reopened)).toHaveText('1')
  } finally {
    await fresh.close()
  }
})

test('通过 Chromium 合成中文输入时不提前提交画布历史', async ({ page, context }) => {
  await page.goto(spike)
  const box = (await stage(page).boundingBox())!
  await page.mouse.dblclick(box.x + 24 + 225, box.y + 16 + 165)
  const editor = page.locator('textarea[data-fabric="textarea"]')
  await expect(editor).toBeFocused()
  await page.keyboard.press('Control+a')

  // 调用浏览器合成输入通道，不等于验证 Windows 输入法的候选窗或按键语义。
  const cdp = await context.newCDPSession(page)
  try {
    await cdp.send('Input.imeSetComposition', { text: 'zhongwen', selectionStart: 8, selectionEnd: 8 })
    await expect(editor).toHaveValue('zhongwen')
    await expect(count(page)).toHaveText('0')
    await cdp.send('Input.insertText', { text: '中文' })
    await expect(editor).toHaveValue('中文')
    await expect(count(page)).toHaveText('0')
  } finally {
    await cdp.detach()
  }
  await page.mouse.click(box.x + 10, box.y + 440)
  await expect(count(page)).toHaveText('1')
  expect((await state(page)).text.value).toBe('中文')
})

test('选区 SVG 不受视口影响，保留中文、旋转矩形与完整箭头', async ({ page }, testInfo) => {
  await page.goto(spike)
  const exportButton = page.getByRole('button', { name: '导出选中 SVG' })
  await expect(exportButton).toBeDisabled()
  await page.getByRole('button', { name: '选中验证图元' }).click()
  await expect(exportButton).toBeEnabled()

  async function exportAt(zoom: string) {
    await page.getByRole('combobox', { name: '画布缩放' }).selectOption(zoom)
    const downloading = page.waitForEvent('download')
    await exportButton.click()
    return await downloading
  }

  const atHalf = await exportAt('0.5')
  const svg = await readFile((await atHalf.path())!, 'utf8')
  const atDouble = await exportAt('2')
  expect(await readFile((await atDouble.path())!, 'utf8')).toBe(svg)
  expect(svg).not.toMatch(/#a21caf|rgb\(162,28,175\)|#eef5fa|foreignObject/i)

  const actual = await page.evaluate(async (markup) => {
    const doc = new DOMParser().parseFromString(markup, 'image/svg+xml')
    const text = doc.querySelector('text')?.textContent?.trim()
    const shapes = doc.querySelectorAll('rect, polygon').length
    const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }))
    try {
      const image = new Image()
      image.src = url
      await image.decode()
      const surface = document.createElement('canvas')
      surface.width = image.naturalWidth
      surface.height = image.naturalHeight
      const ctx = surface.getContext('2d')!
      ctx.drawImage(image, 0, 0)
      const { width, height } = surface
      const pixels = ctx.getImageData(0, 0, width, height).data
      let ink = 0
      let borderInk = 0
      let arrowInk = 0
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4
          if (pixels[i + 3] < 16) continue
          ink++
          if (x < 2 || y < 2 || x >= width - 2 || y >= height - 2) borderInk++
          if (pixels[i] === 37 && pixels[i + 1] === 99 && pixels[i + 2] === 235) arrowInk++
        }
      }
      return { text, shapes, ink, borderInk, arrowInk }
    } finally {
      URL.revokeObjectURL(url)
    }
  }, svg)
  expect(actual.text).toBe('帧数增加 & 预算不变')
  expect(actual.shapes).toBe(2)
  expect(actual.ink).toBeGreaterThan(1_000)
  expect(actual.arrowInk).toBeGreaterThan(100)
  expect(actual.borderInk).toBe(0)
  await atHalf.saveAs(testInfo.outputPath('personal-mode-spike.svg'))
})
