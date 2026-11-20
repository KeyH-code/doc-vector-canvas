import { ActiveSelection, Canvas, IText, Polygon, Rect, StaticCanvas } from 'fabric'

type Positioned = { id: string; x: number; y: number }
type RectangleData = Positioned & { fill: string }
type TextData = Positioned & { value: string }
type Scene = { rectangle: RectangleData; text: TextData }

function element<T extends HTMLElement>(id: string): T {
  const result = document.getElementById(id)
  if (!result) throw new Error(`找不到验证页面控件：${id}`)
  return result as T
}

const canvas = new Canvas(element<HTMLCanvasElement>('canvas'), {
  width: 790,
  height: 575,
  selection: false,
})
const readout = element('scene-state')
const counter = element<HTMLOutputElement>('count')
const undoButton = element<HTMLButtonElement>('undo')
const zoom = element<HTMLSelectElement>('zoom')
const pan = element<HTMLButtonElement>('pan')
const fileInput = element<HTMLInputElement>('open')
const fileStatus = element<HTMLOutputElement>('file-status')
const exportButton = element<HTMLButtonElement>('export')
let scene: Scene = {
  rectangle: { id: 'rect-1', x: 120, y: 92, fill: '#0f766e' },
  text: { id: 'text-1', x: 225, y: 165, value: '帧数增加 & 预算不变' },
}
const history: Scene[] = []
let commitCount = 0
let syncing = false

function makeRectangle(data: RectangleData) {
  return new Rect({
    originX: 'center', originY: 'center', left: data.x, top: data.y, fill: data.fill,
    width: 78, height: 48, angle: 22, stroke: '#145353', strokeWidth: 6, hasControls: false,
  })
}

function makeText(data: TextData) {
  return new IText(data.value, {
    originX: 'center', originY: 'center', left: data.x, top: data.y, fontSize: 22, fontFamily: 'Microsoft YaHei',
    fill: '#182230', hasControls: false, lockMovementX: true, lockMovementY: true,
  })
}

function makeArrow() {
  return new Polygon([
    { x: 0, y: 15 }, { x: 96, y: 15 }, { x: 96, y: 0 }, { x: 125, y: 20 },
    { x: 96, y: 40 }, { x: 96, y: 25 }, { x: 0, y: 25 },
  ], {
    originX: 'center', originY: 'center', left: 248, top: 236, fill: '#2563eb',
    stroke: '#1e40af', strokeWidth: 4, hasControls: false, lockMovementX: true, lockMovementY: true,
  })
}

function makeExcluded() {
  return new Rect({ left: 338, top: 83, width: 31, height: 31, fill: '#a21caf',
    hasControls: false, lockMovementX: true, lockMovementY: true })
}

const rectangle = makeRectangle(scene.rectangle)
const text = makeText(scene.text)
const arrow = makeArrow()
const excluded = makeExcluded()
const renderables = [
  { active: rectangle, forExport: () => makeRectangle(scene.rectangle) },
  { active: text, forExport: () => makeText(scene.text) },
  { active: arrow, forExport: makeArrow },
  { active: excluded, forExport: makeExcluded },
]
canvas.add(...renderables.map(({ active }) => active))

function render() {
  syncing = true
  try {
    if (canvas.getActiveObject() instanceof ActiveSelection) canvas.discardActiveObject()
    rectangle.set({ left: scene.rectangle.x, top: scene.rectangle.y, fill: scene.rectangle.fill })
    rectangle.setCoords()
    text.set({ left: scene.text.x, top: scene.text.y, text: scene.text.value })
    text.setCoords()
    canvas.requestRenderAll()
    readout.textContent = JSON.stringify(scene, null, 2)
    counter.value = String(commitCount)
    undoButton.disabled = history.length === 0
  } finally {
    syncing = false
  }
}

function updateRectangle(id: string, changes: Partial<Omit<RectangleData, 'id'>>) {
  if (id !== scene.rectangle.id) return
  const next = { ...scene.rectangle, ...changes }
  if (next.x === scene.rectangle.x && next.y === scene.rectangle.y && next.fill === scene.rectangle.fill) return
  commit({ ...scene, rectangle: next })
}

function commit(next: Scene) {
  history.push(scene)
  scene = next
  commitCount += 1
  render()
}

canvas.on('object:modified', ({ target }) => {
  if (syncing || target !== rectangle) return
  const { x, y } = rectangle.getCenterPoint()
  updateRectangle(scene.rectangle.id, { x, y })
})

text.on('editing:exited', () => {
  if (!syncing && text.text !== scene.text.value) {
    commit({ ...scene, text: { ...scene.text, value: text.text } })
  }
})

function updateExportButton() {
  exportButton.disabled = canvas.getActiveObjects().length === 0
}

canvas.on('selection:created', updateExportButton)
canvas.on('selection:updated', updateExportButton)
canvas.on('selection:cleared', updateExportButton)

element('select-demo').addEventListener('click', () => {
  canvas.discardActiveObject()
  canvas.setActiveObject(new ActiveSelection([rectangle, text, arrow], {
    canvas, hasControls: false, lockMovementX: true, lockMovementY: true,
  }))
  canvas.requestRenderAll()
})

element('recolor').addEventListener('click', () => {
  updateRectangle(scene.rectangle.id, { fill: scene.rectangle.fill === '#0f766e' ? '#b45309' : '#0f766e' })
})

undoButton.addEventListener('click', () => {
  const previous = history.pop()
  if (!previous) return
  scene = previous
  render()
})

function download(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

exportButton.addEventListener('click', async () => {
  const selected = new Set(canvas.getActiveObjects())
  const objects = renderables.filter(({ active }) => selected.has(active)).map(({ forExport }) => forExport())
  if (objects.length === 0) return

  const surface = new StaticCanvas(document.createElement('canvas'), { renderOnAddRemove: false })
  try {
    surface.add(...objects)
    const bounds = objects.map((object) => object.getBoundingRect())
    const x = Math.floor(Math.min(...bounds.map((box) => box.left))) - 4
    const y = Math.floor(Math.min(...bounds.map((box) => box.top))) - 4
    const width = Math.ceil(Math.max(...bounds.map((box) => box.left + box.width))) + 4 - x
    const height = Math.ceil(Math.max(...bounds.map((box) => box.top + box.height))) + 4 - y
    const svg = surface.toSVG({ suppressPreamble: true, width: String(width), height: String(height), viewBox: { x, y, width, height } })
    download('personal-mode-spike.svg', svg, 'image/svg+xml')
  } finally {
    await surface.dispose()
  }
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function position(value: unknown, id: string): Positioned {
  if (!isRecord(value) || value.id !== id || typeof value.x !== 'number' || typeof value.y !== 'number' ||
      !Number.isFinite(value.x) || !Number.isFinite(value.y)) {
    throw new Error('无效的小样对象坐标或 ID')
  }
  return { id, x: value.x, y: value.y }
}

function openProject(contents: string): Scene {
  const file: unknown = JSON.parse(contents)
  if (!isRecord(file) || file.format !== 'fabric-spike' || file.version !== 1 || !isRecord(file.scene)) {
    throw new Error('不支持的小样文件')
  }
  const { rectangle, text } = file.scene
  if (!isRecord(rectangle) || typeof rectangle.fill !== 'string' || !/^#[0-9a-f]{6}$/i.test(rectangle.fill) ||
      !isRecord(text) || typeof text.value !== 'string') {
    throw new Error('无效的小样对象属性')
  }
  return {
    rectangle: { ...position(rectangle, 'rect-1'), fill: rectangle.fill },
    text: { ...position(text, 'text-1'), value: text.value },
  }
}

element('save').addEventListener('click', () => {
  if (text.isEditing) canvas.discardActiveObject()
  download('personal-mode-spike.json', JSON.stringify({ format: 'fabric-spike', version: 1, scene }, null, 2), 'application/json')
  fileStatus.value = '已发起小样下载'
})

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0]
  if (!file) return
  try {
    const next = openProject(await file.text())
    canvas.discardActiveObject()
    scene = next
    history.length = 0
    commitCount = 0
    render()
    fileStatus.value = '已打开小样'
  } catch {
    fileStatus.value = '打开失败，当前小样未变更'
  } finally {
    fileInput.value = ''
  }
})

function renderViewport() {
  const scale = Number(zoom.value)
  const shifted = pan.getAttribute('aria-pressed') === 'true'
  const x = shifted ? 48 : 24
  const y = shifted ? 32 : 16
  canvas.setViewportTransform([scale, 0, 0, scale, x, y])
  document.getElementById('reference-view')?.setAttribute('transform', `translate(${x} ${y}) scale(${scale})`)
}

zoom.addEventListener('change', renderViewport)
pan.addEventListener('click', () => {
  pan.setAttribute('aria-pressed', String(pan.getAttribute('aria-pressed') !== 'true'))
  renderViewport()
})

renderViewport()
render()
