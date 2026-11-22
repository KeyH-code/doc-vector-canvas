import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import type { CanvasScene } from '../../src/core/scene'
import { encodeProject } from '../../src/project/projectFile'

const scene: CanvasScene = {
  id: 'svg-acceptance',
  objects: [
    { type: 'rectangle', id: 'rect', x: 260, y: 210, width: 148, height: 84, rotation: 28,
      fill: '#d3e5eb', stroke: '#145353', strokeWidth: 14 },
    { type: 'arrow', id: 'arrow', x: 517, y: 283, dx: 156, dy: 18, rotation: -12,
      stroke: '#2563eb', strokeWidth: 9 },
    { type: 'text', id: 'caption', x: 342, y: 373, rotation: 0, text: '帧数增加 & <预算>\n继续编辑',
      fontFamily: 'Microsoft YaHei, sans-serif', fontSize: 30, color: '#343e4e' },
    { type: 'ellipse', id: 'excluded', x: 816, y: 245, width: 92, height: 72, rotation: 0,
      fill: '#a21caf', stroke: '#a21caf', strokeWidth: 3 },
  ],
}

const fileAction = (page: Page, name: string) => page.getByRole('button', { name, exact: true })
const paint = (page: Page) => page.getByTestId('canvas-stage').locator('canvas[data-fabric="main"]')

async function openScene(page: Page, project: CanvasScene) {
  const choosing = page.waitForEvent('filechooser')
  await fileAction(page, '打开项目').click()
  await (await choosing).setFiles({ name: '选区验收.json', mimeType: 'application/json', buffer: Buffer.from(encodeProject(project)) })
  await expect(page.getByRole('list', { name: '画布对象' }).getByRole('listitem')).toHaveCount(project.objects.length)
}

async function downloadSvg(page: Page) {
  const downloading = page.waitForEvent('download')
  await fileAction(page, '导出选中 SVG').click()
  const file = await downloading
  expect(file.suggestedFilename()).toBe('选区验收-选区.svg')
  return { file, markup: await readFile((await file.path())!, 'utf8') }
}

test('正式页面只下载选区，50% 和 200% 的 SVG 一致且内容无裁边', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  const exportButton = fileAction(page, '导出选中 SVG')
  await expect(exportButton).toBeDisabled()
  await openScene(page, scene)
  await expect(exportButton).toBeDisabled()

  async function useSceneScale(scale: number) {
    // Size the real canvas host so ResizeObserver applies the requested Fabric viewport scale.
    await page.locator('.sheet').evaluate((sheet: HTMLElement, width) => { sheet.style.width = `${width + 2}px` }, scale * 1000)
    await expect(paint(page)).toHaveCSS('width', `${scale * 1000}px`)
    const height = Number.parseFloat(await paint(page).evaluate((el: HTMLCanvasElement) => el.style.height))
    expect(height / (1000 * 450 / 760)).toBeCloseTo(scale, 2)
  }

  await useSceneScale(.5)
  const bounds = (await paint(page).boundingBox())!
  for (const object of [...scene.objects.slice(0, 3)].reverse()) {
    if (object.id !== 'caption') await page.keyboard.down('Shift')
    await page.mouse.click(bounds.x + object.x / 2, bounds.y + object.y / 2)
    await page.keyboard.up('Shift')
  }
  await expect(page.getByRole('status')).toHaveText('已选中 3 个对象')
  await expect(exportButton).toBeEnabled()
  const half = await downloadSvg(page)
  await page.setViewportSize({ width: 2500, height: 1500 })
  await useSceneScale(2)
  expect((await downloadSvg(page)).markup).toBe(half.markup)
  await expect(page.getByRole('status')).toHaveText('已选中 3 个对象')
  await expect(fileAction(page, '撤销')).toBeDisabled()
  await expect(page.getByRole('list', { name: '画布对象' }).getByRole('listitem')).toHaveCount(4)

  const actual = await page.evaluate(async markup => {
    const doc = new DOMParser().parseFromString(markup, 'image/svg+xml')
    const text = Array.from(doc.querySelectorAll('text tspan'), node => node.textContent).join('')
    const tags = Array.from(doc.querySelectorAll('rect, polyline, text, ellipse'), node => node.localName)
    const viewBox = (doc.documentElement.getAttribute('viewBox') ?? '').split(/\s+/).map(Number)
    const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }))
    try {
      const image = new Image()
      image.src = url
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(image, 0, 0)
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data
      let ink = 0, onEdge = 0, arrow = 0, letters = 0
      for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
        const i = (y * canvas.width + x) * 4
        if (pixels[i + 3] < 16) continue
        ink++
        if (x < 2 || y < 2 || x >= canvas.width - 2 || y >= canvas.height - 2) onEdge++
        if (pixels[i] === 37 && pixels[i + 1] === 99 && pixels[i + 2] === 235) arrow++
        if (pixels[i] === 52 && pixels[i + 1] === 62 && pixels[i + 2] === 78) letters++
      }
      return { error: !!doc.querySelector('parsererror'), text, tags, viewBox, ink, onEdge, arrow, letters }
    } finally {
      URL.revokeObjectURL(url)
    }
  }, half.markup)
  expect(actual.error).toBe(false)
  expect(actual.tags).toEqual(['rect', 'polyline', 'text'])
  expect(actual.text).toBe('帧数增加 & <预算>继续编辑')
  expect(actual.viewBox[2]).toBeLessThan(590)
  expect(actual.viewBox[3]).toBeLessThan(340)
  expect(actual.ink).toBeGreaterThan(1000)
  expect(actual.arrow).toBeGreaterThan(300)
  expect(actual.letters).toBeGreaterThan(100)
  expect(actual.onEdge).toBe(0)
  expect(half.markup).not.toMatch(/a21caf|rgb\(162,28,175\)|foreignObject|<!DOCTYPE/i)
  await half.file.saveAs(testInfo.outputPath('personal-selection.svg'))
})

test('导出当前字号预览，但不提交编辑，也不清除重做分支', async ({ page }) => {
  await page.goto('/')
  await openScene(page, scene)
  const box = (await paint(page).boundingBox())!
  const scale = Math.floor(box.width) / 1000
  await page.mouse.click(box.x + 342 * scale, box.y + 365 * scale)
  const size = page.getByLabel('字号', { exact: true })
  await size.fill('42')
  await size.press('Tab')
  await fileAction(page, '撤销').click()
  await expect(fileAction(page, '重做')).toBeEnabled()
  await expect(fileAction(page, '撤销')).toBeDisabled()

  await size.fill('65')
  const { markup } = await downloadSvg(page)
  expect(markup).toMatch(/font-size="65"/)
  await expect(size).toBeFocused()
  await expect(fileAction(page, '重做')).toBeEnabled()
  await expect(fileAction(page, '撤销')).toBeDisabled()
})

test('单独导出文字时，超出排版宽度的组合附标没有被裁掉', async ({ page }) => {
  await page.goto('/')
  const text = { type: 'text', id: 'overhang', x: 400, y: 280, rotation: 0, text: 'A\u3099',
    fontFamily: 'Microsoft YaHei, sans-serif', fontSize: 120, color: '#343e4e' } as const
  await openScene(page, { id: 'text-only', objects: [text] })
  const box = (await paint(page).boundingBox())!
  const scale = Math.floor(box.width) / 1000
  await page.mouse.click(box.x + text.x * scale, box.y + text.y * scale)
  const { markup } = await downloadSvg(page)
  const result = await page.evaluate(async source => {
    const svg = new DOMParser().parseFromString(source, 'image/svg+xml').documentElement
    const [x, y, width, height] = (svg.getAttribute('viewBox') ?? '').split(/\s+/).map(Number)
    // Expand the document without changing rendering scale, then look for pixels outside the original crop.
    const pad = 200
    svg.setAttribute('width', String(width + pad * 2))
    svg.setAttribute('height', String(height + pad * 2))
    svg.setAttribute('viewBox', `${x - pad} ${y - pad} ${width + pad * 2} ${height + pad * 2}`)
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }))
    try {
      const img = new Image()
      img.src = url
      await img.decode()
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data
      let ink = 0, outside = 0
      for (let row = 0; row < canvas.height; row++) for (let column = 0; column < canvas.width; column++) {
        if (pixels[(row * canvas.width + column) * 4 + 3] < 16) continue
        ink++
        if (column < pad || column >= pad + width || row < pad || row >= pad + height) outside++
      }
      return { ink, outside }
    } finally {
      URL.revokeObjectURL(url)
    }
  }, markup)
  expect(result.ink).toBeGreaterThan(100)
  expect(result.outside).toBe(0)
})
