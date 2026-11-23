import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { pdfFixture } from '../fixtures/documents/pdfFixture'
import { PDFArray, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib'

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true })
async function openFile(page: Page, name: string, buffer: Buffer) {
  const pending = page.waitForEvent('filechooser')
  await button(page, '打开项目').click()
  await (await pending).setFiles({ name, mimeType: name.endsWith('.pdf') ? 'application/pdf' : 'application/json', buffer })
}

async function save(page: Page, label = '保存项目') {
  const pending = page.waitForEvent('download')
  await button(page, label).click()
  return readFile((await (await pending).path())!)
}

test('真实 PDF 本地导入，页尺寸与文本保留，项目断网重开后从原始 PDF 恢复底稿', async ({ page, browser }) => {
  await page.goto('/')
  const bytes = pdfFixture()
  await openFile(page, '两页底稿.pdf', bytes)
  await expect(button(page, '第 1 页')).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('button', { name: '第 1 页', exact: true }).locator('img')).toBeVisible()
  const saved = await save(page)
  const doc = JSON.parse(saved.toString()).scene.document
  expect(doc.source.data).toBe(bytes.toString('base64'))
  expect(doc.pages.map(({ width, height, text }: { width: number; height: number; text: string }) => [width, height, text])).toEqual([
    [200, 300, 'FIRST BASE TEXT'], [200, 320, 'SECOND BASE TEXT'],
  ])
  const context = await browser.newContext()
  try {
    const fresh = await context.newPage()
    await fresh.goto('/')
    await expect(button(fresh, '打开项目')).toBeVisible()
    await context.setOffline(true)
    await openFile(fresh, '离线.pdf.json', saved)
    await expect(button(fresh, '第 1 页')).toHaveAttribute('aria-current', 'page')
    await button(fresh, '第 2 页').click()
    await expect(button(fresh, '第 2 页').locator('img')).toBeVisible()
    await expect(button(fresh, '撤销')).toBeDisabled()
    expect(await save(fresh)).toEqual(saved)
  } finally { await context.close() }
})

test('损坏 PDF 不替换当前项目，也不清除已产生的撤销', async ({ page }) => {
  await page.goto('/')
  await openFile(page, '两页.pdf', pdfFixture())
  await expect(button(page, '第 1 页')).toBeVisible()
  await button(page, '矩形').click()
  const bounds = (await page.getByTestId('canvas-stage').boundingBox())!
  await page.mouse.move(bounds.x + 180, bounds.y + 200); await page.mouse.down()
  await page.mouse.move(bounds.x + 240, bounds.y + 250); await page.mouse.up()
  await expect(button(page, '撤销')).toBeEnabled()
  await openFile(page, '损坏.pdf', Buffer.from('%PDF-1.4\nbad\n%%EOF'))
  await expect(page.getByRole('alert')).toContainText('PDF')
  await expect(button(page, '选中矩形 1')).toBeVisible()
  await expect(button(page, '撤销')).toBeEnabled()
})

test('导出单页和整份 PDF：按原页裁切、保留原文与页外项目数据', async ({ page }) => {
  await page.goto('/')
  await openFile(page, '导出底稿.pdf', pdfFixture())
  await expect(button(page, '第 1 页')).toBeVisible()
  const saved = JSON.parse((await save(page)).toString())
  saved.scene.document.pages[0].scene.objects = [
    { type: 'arrow', id: 'cross', x: 205, y: 150, dx: 50, dy: 0, rotation: 0, stroke: '#ff0000', strokeWidth: 5 },
    { type: 'rectangle', id: 'outside', x: 250, y: 95, width: 30, height: 30, rotation: 0, fill: '#8080ff', stroke: '#8080ff', strokeWidth: 2 },
  ]
  await openFile(page, '裁切.json', Buffer.from(JSON.stringify(saved)))
  await expect(page.getByText('裁切', { exact: true })).toBeVisible()
  await button(page, '第 1 页').click({ button: 'right' })
  await page.getByRole('menuitem', { name: '隐藏底稿', exact: true }).click()
  expect(JSON.parse((await save(page)).toString())).toEqual(saved)
  await button(page, '导出 PDF').click()
  await button(page, '当前页').click()
  await expect(page.getByText(/1 个完全在页外.*1 个跨过页边/)).toBeVisible()
  const exported = await save(page, '下载 PDF')
  const pdf = await PDFDocument.load(exported)
  expect(pdf.getPageCount()).toBe(1)
  expect(pdf.getPage(0).getSize()).toEqual({ width: 200, height: 300 })
  // Opening the exported PDF through the real reader proves the original text layer survived.
  await openFile(page, '单页输出.pdf', exported)
  await expect(page.getByText('单页输出', { exact: true })).toBeVisible()
  const imported = JSON.parse((await save(page)).toString()).scene.document.pages[0]
  expect(imported.text).toBe('FIRST BASE TEXT')

  await openFile(page, '裁切.json', Buffer.from(JSON.stringify(saved)))
  await expect(page.getByText('裁切', { exact: true })).toBeVisible()
  await button(page, '第 2 页').click()
  await expect(button(page, '第 2 页')).toHaveAttribute('aria-current', 'page')
  await button(page, '导出 PDF').click()
  await button(page, '当前页').click()
  const rotated = await PDFDocument.load(await save(page, '下载 PDF'))
  expect(rotated.getPageCount()).toBe(1)
  expect(rotated.getPage(0).getRotation().angle).toBe(90)
  await button(page, '导出 PDF').click()
  await button(page, '指定页码').click()
  await page.getByLabel('页码范围').fill('0,3')
  await expect(button(page, '下载 PDF')).toBeDisabled()
  await page.getByLabel('页码范围').fill('2,1,2')
  const all = await PDFDocument.load(await save(page, '下载 PDF'))
  expect(all.getPages().map(p => [p.getWidth(), p.getHeight(), p.getRotation().angle])).toEqual([[200, 300, 0], [340, 240, 90]])
  expect(JSON.parse((await save(page)).toString())).toEqual(saved)
  await expect(button(page, '撤销')).toBeDisabled()
})

test('取消在途的 PDF 打开，原有对象和撤销历史留在原项目', async ({ page }) => {
  await page.goto('/')
  await button(page, '矩形').click()
  const stage = (await page.getByTestId('canvas-stage').boundingBox())!
  await page.mouse.move(stage.x + 100, stage.y + 80); await page.mouse.down()
  await page.mouse.move(stage.x + 165, stage.y + 140); await page.mouse.up()
  await page.evaluate(() => {
    const read = File.prototype.arrayBuffer
    File.prototype.arrayBuffer = async function () {
      if (this.type === 'application/pdf') await new Promise<void>(resolve => window.addEventListener('finish-pdf-read', () => resolve(), { once: true }))
      return read.call(this)
    }
  })
  await openFile(page, '取消.pdf', pdfFixture())
  await button(page, '取消打开').click()
  await page.evaluate(() => window.dispatchEvent(new Event('finish-pdf-read')))
  await expect(button(page, '选中矩形 1')).toBeVisible()
  await expect(button(page, '撤销')).toBeEnabled()
  expect(JSON.parse((await save(page)).toString()).version).toBe(2)
})

test('带内部链接的原稿导出单页，不把跳转目标页的内容藏进输出文件', async ({ page }) => {
  await page.goto('/')
  const base = await PDFDocument.load(pdfFixture())
  const [first, second] = base.getPages()
  const link = base.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [10, 20, 60, 50], Dest: [second.ref, 'Fit'] })
  first.node.set(PDFName.of('Annots'), base.context.obj([base.context.register(link)]) as PDFArray)
  await openFile(page, '内部链接.pdf', Buffer.from(await base.save()))
  await expect(button(page, '第 1 页')).toBeVisible()
  await button(page, '导出 PDF').click()
  await button(page, '当前页').click()
  const pdf = await PDFDocument.load(await save(page, '下载 PDF'))
  expect(pdf.getPageCount()).toBe(1)
  const streams = pdf.context.enumerateIndirectObjects().flatMap(([, object]) => object instanceof PDFRawStream
    ? [Buffer.from(decodePDFRawStream(object).decode()).toString('ascii')] : []).join('\n')
  expect(streams).toContain('FIRST BASE TEXT')
  expect(streams).not.toContain('SECOND BASE TEXT')
})

test('只预览 PDF 并返回，不把属性预览写入撤销历史', async ({ page }) => {
  await page.goto('/')
  await openFile(page, '属性.pdf', pdfFixture())
  await expect(button(page, '第 1 页')).toBeVisible()
  const project = JSON.parse((await save(page)).toString())
  project.scene.document.pages[0].scene.objects = [{ id: 'rect', type: 'rectangle', x: 100, y: 150, width: 70, height: 40,
    rotation: 0, fill: '#ffffff', stroke: '#111111', strokeWidth: 2 }]
  await openFile(page, '属性项目.json', Buffer.from(JSON.stringify(project)))
  await button(page, '选中矩形 1').click()
  await page.getByLabel('线宽', { exact: true }).fill('18')
  await expect(button(page, '撤销')).toBeDisabled()
  await button(page, '导出 PDF').click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await button(page, '返回画布').click()
  await expect(button(page, '撤销')).toBeDisabled()
})
