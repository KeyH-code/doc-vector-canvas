import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { safeUnzipSync } from '@web-ppt/core/zip'

const mime = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
const bluePng = 'iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAE0lEQVR4nGMUbbrDAANMcBY6BwA1dAF5c9UVkwAAAABJRU5ErkJggg=='
const fixture = (name: string) => readFile(new URL(`../fixtures/documents/${name}.pptx`, import.meta.url))
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true })

async function open(page: Page, name: string, buffer: Buffer) {
  const chosen = page.waitForEvent('filechooser')
  await button(page, '打开项目').click()
  await (await chosen).setFiles({ name, mimeType: name.endsWith('.json') ? 'application/json' : mime, buffer })
}

async function save(page: Page) {
  const download = page.waitForEvent('download')
  await button(page, '保存项目').click()
  return readFile((await (await download).path())!)
}

async function drawRectangle(page: Page) {
  await button(page, '矩形').click()
  const stage = (await page.getByTestId('canvas-stage').boundingBox())!
  await page.mouse.move(stage.x + 200, stage.y + 140); await page.mouse.down()
  await page.mouse.move(stage.x + 255, stage.y + 185); await page.mouse.up()
  await expect(button(page, '选中矩形 1')).toBeVisible()
}

for (const [sample, width] of [['wide', 960], ['standard', 720]] as const) {
  test(`打开真实 ${sample} PPTX：保留三页（含隐藏页）、原尺寸、锁定底稿和只读文字`, async ({ page, browser }) => {
    await page.goto('/')
    const fixtureBytes = await fixture(sample)
    await open(page, `${sample}.pptx`, fixtureBytes)
    await expect(button(page, '第 1 页')).toHaveAttribute('aria-current', 'page')
    await expect(button(page, '第 1 页').locator('img')).toBeVisible()
    await expect(button(page, '第 4 页')).toHaveCount(0)
    await expect(button(page, '导出 PDF')).toHaveCount(0)
    await expect(page.getByText('暂无对象', { exact: true })).toBeVisible()
    await expect(button(page, '删除')).toBeDisabled()
    await button(page, '第 2 页').click()
    await drawRectangle(page)
    await button(page, '第 3 页').click()
    await expect(button(page, '第 3 页')).toHaveAttribute('aria-current', 'page')
    await expect(button(page, '选中矩形 1')).toHaveCount(0)
    const saved = await save(page)
    const project = JSON.parse(saved.toString())
    expect(project.version).toBe(3)
    const doc = project.scene.document
    expect(doc.source.kind).toBe('pptx')
    expect(doc.source.backgrounds).toHaveLength(3)
    expect(doc.source.backgrounds.every((data: string) => data.startsWith('iVBORw0KGgo'))).toBe(true)
    expect(saved.toString()).not.toContain(fixtureBytes.toString('base64'))
    expect(doc.pages.map((p: { width: number; height: number }) => [p.width, p.height])).toEqual(Array(3).fill([width, 540]))
    expect(doc.pages[0].text).toContain('中文排版与母版')
    expect(doc.pages[1].text).toContain('第二组')
    expect(doc.pages[2].text).toContain('隐藏页')
    const pixels = await page.evaluate(async (backgrounds: string[]) => {
      const samples = []
      for (const data of backgrounds) {
        const image = new Image()
        image.src = `data:image/png;base64,${data}`
        await image.decode()
        const canvas = document.createElement('canvas')
        canvas.width = image.width; canvas.height = image.height
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(image, 0, 0)
        samples.push({ dimensions: [image.width, image.height], master: [...ctx.getImageData(12, 12, 1, 1).data],
          marker: [...ctx.getImageData(Math.round(image.height * 120 / 900), Math.round(image.height * 310 / 900), 1, 1).data] })
      }
      return samples
    }, doc.source.backgrounds)
    expect(pixels.map(p => p.dimensions)).toEqual(Array(3).fill([1600, sample === 'wide' ? 900 : 1200]))
    expect(pixels.every(p => p.master.join(',') === '161,34,112,255')).toBe(true)
    expect(pixels[2].marker[1]).toBeCloseTo(137, 0)
    expect(pixels[2].marker[0]).toBeLessThan(30)
    if (sample === 'standard') return

    const context = await browser.newContext()
    try {
      const offline = await context.newPage()
      await offline.goto('/')
      await expect(button(offline, '打开项目')).toBeVisible()
      await context.setOffline(true)
      await open(offline, '另存.json', saved)
      await expect(button(offline, '第 1 页').locator('img')).toBeVisible()
      await button(offline, '第 2 页').click()
      await expect(button(offline, '选中矩形 1')).toBeVisible()
      await expect(button(offline, '第 2 页').locator('img')).toBeVisible()
      await expect(button(offline, '撤销')).toBeDisabled()
      expect(await save(offline)).toEqual(saved)
      doc.source.backgrounds[2] = doc.source.backgrounds[2].slice(0, 80)
      await open(offline, '损坏存档.json', Buffer.from(JSON.stringify(project)))
      await expect(offline.getByRole('alert')).toContainText('底稿数据无效')
      await expect(button(offline, '选中矩形 1')).toBeVisible()
    } finally { await context.close() }
  })
}

test('坏包、外链图不接管已有画布且不请求外部地址，导入可取消', async ({ page }) => {
  const outside: string[] = []
  await page.route('https://example.invalid/**', route => { outside.push(route.request().url()); return route.abort() })
  await page.goto('/')
  await drawRectangle(page)
  await open(page, '坏包.pptx', (await fixture('wide')).subarray(0, 100))
  await expect(page.getByRole('alert')).toContainText('PPTX')
  await open(page, '伪装的宏文档.pptx', await fixture('macro'))
  await expect(page.getByRole('alert')).toContainText('宏')
  await open(page, '加密容器.pptx', Buffer.from('d0cf11e0a1b11ae1', 'hex'))
  await expect(page.getByRole('alert')).toContainText('加密')
  await open(page, '外链.pptx', await fixture('external'))
  await expect(page.getByRole('alert')).toContainText('外部')
  expect(outside).toEqual([])

  await page.evaluate(() => {
    const read = File.prototype.arrayBuffer
    File.prototype.arrayBuffer = async function () {
      if (this.name.endsWith('.pptx')) await new Promise<void>(resolve => window.addEventListener('test-resume-pptx', () => resolve(), { once: true }))
      return read.call(this)
    }
  })
  await open(page, '取消.pptx', await fixture('wide'))
  await button(page, '取消打开').click()
  await page.evaluate(() => window.dispatchEvent(new Event('test-resume-pptx')))
  await expect(button(page, '选中矩形 1')).toBeVisible()
  await expect(button(page, '撤销')).toBeEnabled()
  expect(JSON.parse((await save(page)).toString()).version).toBe(2)
})

test('在途渲染可取消或超时，清理隔离框并保留现有项目', async ({ page }) => {
  // Drop completion messages after the renderer reports starting its first real page.
  await page.addInitScript(() => {
    const proto = HTMLIFrameElement.prototype
    const source = Object.getOwnPropertyDescriptor(proto, 'srcdoc')!
    Object.defineProperty(proto, 'srcdoc', { ...source, set(this: HTMLIFrameElement, html: string) {
      source.set!.call(this, this.classList.contains('pptx-render-frame')
        ? html.replace(/(<script nonce="[^"]+">)/,
          '$1{const send=MessagePort.prototype.postMessage;MessagePort.prototype.postMessage=function(data,...args){' +
          'if(data?.type==="success"||data?.type==="error"||(data?.type==="progress"&&data.page!==1))return;' +
          'return send.call(this,data,...args);};}\n') : html)
    } })
  })
  await page.clock.install()
  await page.goto('/')
  await drawRectangle(page)
  const source = await fixture('wide')
  const frame = page.locator('iframe.pptx-render-frame')
  await open(page, '取消.pptx', source)
  await expect(frame).toHaveCount(1)
  await expect(page.getByText('正在生成底稿：1 / 3')).toBeVisible()
  await button(page, '取消打开').click()
  await expect(frame).toHaveCount(0)
  await open(page, '超时.pptx', source)
  await expect(frame).toHaveCount(1)
  await expect(page.getByText('正在生成底稿：1 / 3')).toBeVisible()
  await page.clock.fastForward(46_000)
  await expect(page.getByRole('alert')).toContainText('超时')
  await expect(frame).toHaveCount(0)
  await expect(button(page, '选中矩形 1')).toBeVisible()
  await expect(button(page, '撤销')).toBeEnabled()
})

for (const [sample, message] of [['duplicate-link', '重复'], ['missing-image', '缺少'], ['utf16', '编码']] as const) {
  test(`拒绝会产生错页或缺内容的 PPTX（${sample}）`, async ({ page }) => {
    await page.goto('/')
    await drawRectangle(page)
    await open(page, `${sample}.pptx`, await fixture(sample))
    await expect(page.getByRole('alert')).toContainText(message)
    await expect(button(page, '选中矩形 1')).toBeVisible()
    await expect(button(page, '撤销')).toBeEnabled()
  })
}

test('幻灯片部件编号与原稿页序不同时，底稿和文字均按原稿页序', async ({ page }) => {
  await page.goto('/')
  await open(page, 'reordered.pptx', await fixture('reordered'))
  await expect(button(page, '第 1 页')).toHaveAttribute('aria-current', 'page')
  const doc = JSON.parse((await save(page)).toString()).scene.document
  expect(doc.pages.map((p: { text: string }) => p.text.split('\n')[0])).toEqual(['16:9 / 03', '16:9 / 02', '16:9 / 01'])
  const marker = await page.evaluate(async (data: string) => {
    const image = new Image()
    image.src = `data:image/png;base64,${data}`
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.width; canvas.height = image.height
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(image, 0, 0)
    return [...ctx.getImageData(120, 310, 1, 1).data]
  }, doc.source.backgrounds[0])
  expect(marker[0]).toBeLessThan(30)
  expect(marker.slice(1)).toEqual([137, 105, 255])
})

test('PPTX 按原尺寸与页序导出：保留原生新增对象，跨边只输出页内部分', async ({ page }) => {
  await page.goto('/')
  await open(page, 'standard.pptx', await fixture('standard'))
  await expect(button(page, '第 1 页')).toHaveAttribute('aria-current', 'page')
  const project = JSON.parse((await save(page)).toString())
  const pages = project.scene.document.pages
  const base = { y: 350, rotation: 0, stroke: '#003399', strokeWidth: 4, fill: '#19ab43' }
  pages[0].scene.objects = [
    { id: 'visible-text', type: 'text', x: 250, y: 465, rotation: 0, text: '可编辑文字 A', fontFamily: '"Microsoft YaHei", sans-serif', fontSize: 26, color: '#142036' },
    { ...base, id: 'rect1', type: 'rectangle', x: 350, width: 80, height: 50 },
    { id: 'cross1', type: 'arrow', x: 718, y: 385, rotation: 0, dx: 110, dy: 0, stroke: '#ff0000', strokeWidth: 6 },
    { ...base, id: 'offpage1', type: 'rectangle', x: 850, width: 40, height: 40 },
    { ...base, id: 'oval1', type: 'ellipse', x: 650, width: 70, height: 45 },
    { id: 'line1', type: 'line', x: 475, y: 460, rotation: 0, dx: -70, dy: 26, stroke: '#002299', strokeWidth: 4 },
  ]
  const sampleImage = { id: 'blue', mime: 'image/png', width: 4, height: 3, data: bluePng }
  pages[1].scene.images = [sampleImage]
  pages[1].scene.objects = [
    { id: 'image', type: 'image', assetId: 'blue', x: 0, y: 430, width: 100, height: 60, rotation: 25 },
    { ...base, id: 'center-rect', type: 'rectangle', x: 50, y: 430, width: 30, height: 40 },
    { id: 'curve', type: 'line', x: 660, y: 475, rotation: 0, dx: 100, dy: 0, stroke: '#f10000', strokeWidth: 10,
      path: { kind: 'curve', start: { x: 0, y: 0 }, segments: [{ id: 0, c1: { x: 40, y: -90 }, c2: { x: 60, y: 45 }, to: { x: 100, y: 0 } }] } },
  ]
  pages[2].scene.objects = [{ id: 'third', type: 'text', x: 295, y: 450, rotation: 0, text: 'PPTX THIRD PAGE', fontFamily: 'Arial', fontSize: 18, color: '#303030' }]
  await open(page, '可编辑演示.json', Buffer.from(JSON.stringify(project)))
  await expect(page.getByText('可编辑演示', { exact: true })).toBeVisible()
  const original = await save(page)
  await button(page, '第 1 页').click({ button: 'right' })
  await page.getByRole('menuitem', { name: '隐藏底稿' }).click()
  const readPptx = (bytes: Buffer) => {
    const parts = safeUnzipSync(bytes)
    const xml = (path: string) => Buffer.from(parts[path]).toString()
    return { parts, xml, pages: Object.keys(parts).filter(key => /^ppt\/slides\/slide\d+\.xml$/.test(key)) }
  }
  async function download() {
    const pending = page.waitForEvent('download')
    await button(page, '下载 PPTX').click()
    const result = await pending
    expect(result.suggestedFilename()).toMatch(/\.pptx$/)
    const buffer = await readFile((await result.path())!)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    return buffer
  }
  await button(page, '导出 PPTX').click()
  await expect(page.getByText(/1 个完全在页外.*1 个跨过页边/)).toBeVisible()
  await expect(page.getByText(/1 个可见对象转为图片/)).toBeVisible()
  const all = readPptx(await download())
  expect(all.pages).toHaveLength(3)
  expect(all.xml('ppt/presentation.xml')).toContain('cx="9144000" cy="6858000"')
  const slide = all.xml('ppt/slides/slide1.xml')
  const validXml = await page.evaluate(xml => !new DOMParser().parseFromString(xml, 'application/xml').querySelector('parsererror'), slide)
  expect(validXml).toBe(true)
  expect(slide).toContain('typeface="Microsoft YaHei"')
  expect(slide).not.toContain('sans-serif')
  expect(slide).toContain('<p:bg>')
  expect(slide).toContain('<a:t>可编辑文字 A</a:t>')
  for (const shape of ['rect', 'ellipse', 'line']) expect(slide).toContain(`prst="${shape}"`)
  expect(slide.match(/<p:pic>/g)).toHaveLength(1)
  expect(slide.match(/<p:sp>/g)).toHaveLength(4)
  expect(slide.indexOf('prst="rect"')).toBeLessThan(slide.indexOf('<p:pic>'))
  expect(slide.indexOf('<p:pic>')).toBeLessThan(slide.indexOf('prst="ellipse"'))
  const slide2 = all.xml('ppt/slides/slide2.xml')
  expect(slide2.match(/<p:pic>/g)).toHaveLength(2)
  expect(slide2.indexOf('<p:pic>')).toBeLessThan(slide2.indexOf('prst="rect"'))
  expect(slide2.lastIndexOf('<p:pic>')).toBeGreaterThan(slide2.indexOf('prst="rect"'))
  expect(Object.values(all.parts).some(bytes => Buffer.from(bytes).toString('base64') === bluePng)).toBe(false)
  const picturePositions = [...slide2.matchAll(/<p:pic>.*?<a:off x="(\d+)" y="(\d+)"\s*\/>.*?<a:ext cx="(\d+)" cy="(\d+)"\s*\/>/gs)]
  expect(picturePositions).toHaveLength(2)
  for (const picture of picturePositions) {
    const [, x, y, w, h] = picture.map(Number)
    expect(x + w).toBeLessThanOrEqual(9144000)
    expect(y + h).toBeLessThanOrEqual(6858000)
  }
  await button(page, '第 3 页').click()
  await button(page, '导出 PPTX').click()
  await button(page, '当前页').click()
  const current = readPptx(await download())
  expect(current.pages).toHaveLength(1)
  expect(current.xml('ppt/slides/slide1.xml')).toContain('PPTX THIRD PAGE')
  await button(page, '导出 PPTX').click()
  await button(page, '指定页码').click()
  await page.getByLabel('页码范围').fill('0,4')
  await expect(button(page, '下载 PPTX')).toBeDisabled()
  await page.getByLabel('页码范围').fill('3,1,3')
  const range = readPptx(await download())
  expect(range.pages).toHaveLength(2)
  expect(range.xml('ppt/slides/slide1.xml')).toContain('可编辑文字 A')
  expect(range.xml('ppt/slides/slide2.xml')).toContain('PPTX THIRD PAGE')
  expect(await save(page)).toEqual(original)
  await expect(button(page, '撤销')).toBeDisabled()
})

test('复用新增图片媒体，分开复杂图元的选择框，贴边默认文字不写成原生文本', async ({ page }) => {
  await page.goto('/')
  await open(page, 'standard.pptx', await fixture('standard'))
  await expect(button(page, '第 1 页')).toHaveAttribute('aria-current', 'page')
  const project = JSON.parse((await save(page)).toString()), scene = project.scene.document.pages[0].scene
  scene.images = [{ id: 'blue', mime: 'image/png', width: 4, height: 3, data: bluePng }]
  const pic = { type: 'image', assetId: 'blue', y: 416, width: 30, height: 24, rotation: 0 }
  const square = { x: 320, y: 460, width: 56, height: 56, rotation: 0, fill: '#10ab55', stroke: '#154411', strokeWidth: 3 }
  scene.objects = [
    { ...pic, id: 'image1', x: 420 }, { ...pic, id: 'image2', x: 470 },
    { ...square, id: 'center', type: 'square' },
    { ...square, id: 'left', type: 'star', x: 125 }, { ...square, id: 'right', type: 'star', x: 565 },
    { type: 'text', id: 'tight', x: 360, y: 523, rotation: 0, text: 'PPTX TIGHT TEXT', fontSize: 29,
      fontFamily: 'Microsoft YaHei, sans-serif', color: '#142036' },
  ]
  await open(page, '对象检查.json', Buffer.from(JSON.stringify(project)))
  await expect(page.getByText('对象检查', { exact: true })).toBeVisible()
  await button(page, '导出 PPTX').click()
  await expect(page.getByText(/3 个可见对象转为图片/)).toBeVisible()
  const downloaded = page.waitForEvent('download')
  await button(page, '下载 PPTX').click()
  const parts = safeUnzipSync(await readFile((await (await downloaded).path())!))
  expect(Object.values(parts).filter(part => Buffer.from(part).toString('base64') === bluePng)).toHaveLength(1)
  const xml = Buffer.from(parts['ppt/slides/slide1.xml']).toString()
  expect(xml).not.toContain('PPTX TIGHT TEXT')
  expect(xml.match(/<p:pic>/g)).toHaveLength(5)
  const native = xml.match(/<p:sp>.*?<\/p:sp>/gs)
  expect(native).toHaveLength(1)
  expect(native![0]).toContain('prst="rect"')
})

test('图片插入尚未完成时不创建过时的导出快照', async ({ page }) => {
  await page.goto('/')
  await open(page, 'standard.pptx', await fixture('standard'))
  await expect(button(page, '第 1 页')).toHaveAttribute('aria-current', 'page')
  await page.evaluate(() => {
    const read = File.prototype.arrayBuffer
    File.prototype.arrayBuffer = async function () {
      if (this.type === 'image/png') await new Promise<void>(resolve => window.addEventListener('test-image-read', () => resolve(), { once: true }))
      return read.call(this)
    }
  })
  const picker = page.waitForEvent('filechooser')
  await button(page, '插入图片').click()
  await (await picker).setFiles({ name: '蓝色.png', mimeType: 'image/png', buffer: Buffer.from(bluePng, 'base64') })
  await expect(button(page, '导出 PPTX')).toBeDisabled()
  await page.evaluate(() => window.dispatchEvent(new Event('test-image-read')))
  await expect(button(page, '选中图片 1')).toBeVisible()
  await expect(button(page, '导出 PPTX')).toBeEnabled()
})
