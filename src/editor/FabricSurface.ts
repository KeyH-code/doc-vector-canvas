import { ActiveSelection, Canvas, Ellipse, IText, Point, Polyline, Rect, type FabricObject } from 'fabric'
import type { ObjectChanges, SceneCommand } from '../core/commands'
import { drawingGeometry, strokePoints, type DrawingType, type ScenePoint } from '../core/geometry'
import { isCanvasObject, type CanvasObject, type CanvasScene, type TextObject } from '../core/scene'

export type Tool = 'select' | 'text' | DrawingType
type Shape = Exclude<CanvasObject, TextObject>
type ShapeView = Rect | Ellipse | Polyline

export const paperWidth = 1000
export const paperHeight = paperWidth * 450 / 760
const rectangleStyle = { fill: '#e0eaf3', stroke: '#6381a2', strokeWidth: 2 }
const strokeStyle = { stroke: '#547798', strokeWidth: 4 }
const textStyle = { fontFamily: 'Microsoft YaHei, sans-serif', fontSize: 34, color: '#797b82' }

function makeShape(type: Shape['type']): ShapeView {
  if (type === 'rectangle') return new Rect({ strokeUniform: true })
  if (type === 'ellipse') return new Ellipse({ strokeUniform: true })
  return new Polyline([], { fill: '', strokeLineCap: 'round', strokeLineJoin: 'round',
    perPixelTargetFind: true, padding: 7 })
}

function pathOffset(object: Polyline) {
  return new Point(object.pathOffset.x * object.scaleX, object.pathOffset.y * object.scaleY).rotate(object.angle * Math.PI / 180)
}

function paintShape(object: ShapeView, shape: Shape) {
  const dash = Math.max(shape.strokeWidth, 1)
  object.set({ stroke: shape.stroke, strokeWidth: shape.strokeWidth, strokeDashArray: shape.strokeStyle === 'dashed' ? [dash * 3, dash * 2] : null })
  if (object instanceof Rect && shape.type === 'rectangle') {
    object.set({ width: shape.width, height: shape.height, fill: shape.fill })
  } else if (object instanceof Ellipse && shape.type === 'ellipse') {
    object.set({ rx: shape.width / 2, ry: shape.height / 2, fill: shape.fill })
  } else if (object instanceof Polyline && (shape.type === 'stroke' || shape.type === 'line' || shape.type === 'arrow')) {
    object.set({ points: strokePoints(shape).map(({ x, y }) => ({ x, y })), dirty: true })
    object.setBoundingBox()
    const offset = pathOffset(object)
    object.set({ left: shape.x + offset.x, top: shape.y + offset.y })
  }
}

function paintObject(object: FabricObject, data: CanvasObject) {
  if (object instanceof IText && data.type === 'text') {
    object.set({ text: data.text, fontFamily: data.fontFamily, fontSize: data.fontSize, fill: data.color })
  } else if ((object instanceof Rect || object instanceof Ellipse || object instanceof Polyline) && data.type !== 'text') {
    paintShape(object, data)
  }
  object.setCoords()
}

function shapeFromGesture(id: string, type: DrawingType, points: readonly ScenePoint[]): Shape | undefined {
  const geometry = drawingGeometry(type, points)
  if (!geometry) return
  const common = { id, rotation: 0 }
  if ('width' in geometry) {
    if (geometry.width < 4 || geometry.height < 4) return
    return { ...common, ...rectangleStyle, ...geometry }
  }
  if ('dx' in geometry && Math.hypot(geometry.dx, geometry.dy) < 4) return
  return { ...common, ...strokeStyle, ...geometry }
}

export class FabricSurface {
  private readonly canvas: Canvas
  private readonly resize: ResizeObserver
  private readonly objects = new Map<string, { type: CanvasObject['type']; data: CanvasObject; view: FabricObject }>()
  private readonly ids = new WeakMap<FabricObject, string>()
  private tool: Tool = 'select'
  private drawing?: { id: string; type: DrawingType; points: ScenePoint[]; preview?: ShapeView }
  private placingText = false
  private draft?: { id: string; object: IText; data: TextObject }
  private editing?: IText
  private editingCenter?: Point
  private textBeforeEdit = ''
  private composition?: { value: string; start: number; end: number }
  private pendingSelection?: readonly string[]
  private syncing = false

  constructor(element: HTMLCanvasElement, host: HTMLElement, private readonly events: {
    commit: (commands: readonly SceneCommand[]) => void
    selection: (ids: string[]) => void
    tool: (tool: Tool) => void
    editing: (editing: boolean) => void
  }) {
    const canvas = this.canvas = new Canvas(element, { selection: true, selectionKey: 'shiftKey', uniScaleKey: null,
      preserveObjectStacking: true, targetFindTolerance: 7 })
    this.resize = new ResizeObserver(([entry]) => {
      const width = Math.floor(entry.contentRect.width)
      const height = Math.floor(entry.contentRect.height)
      if (width < 1 || height < 1) return
      const scale = Math.min(width / paperWidth, height / paperHeight)
      canvas.setDimensions({ width, height })
      canvas.setViewportTransform([scale, 0, 0, scale, (width - paperWidth * scale) / 2, (height - paperHeight * scale) / 2])
    })
    this.resize.observe(host)

    canvas.on('mouse:down', ({ e, scenePoint }) => {
      if ('button' in e && e.button !== 0) return
      if (this.tool === 'text') this.placingText = true
      if (this.tool === 'select' || this.tool === 'text' || this.drawing) return
      this.drawing = { id: crypto.randomUUID(), type: this.tool, points: [this.paperPoint(scenePoint)] }
    })
    canvas.on('mouse:move', ({ scenePoint }) => {
      const drawing = this.drawing
      if (!drawing) return
      const data = this.drawTo(scenePoint)
      if (!data) {
        if (drawing.preview) canvas.remove(drawing.preview)
        drawing.preview = undefined
        return
      }
      if (!drawing.preview) {
        drawing.preview = makeShape(data.type)
        drawing.preview.set({ originX: 'center', originY: 'center', selectable: false, evented: false })
        canvas.add(drawing.preview)
      }
      drawing.preview.set({ left: data.x, top: data.y })
      paintShape(drawing.preview, data)
      canvas.requestRenderAll()
    })
    canvas.on('mouse:up', ({ e, scenePoint }) => {
      if ('button' in e && e.button !== 0) return
      if (this.tool === 'text' && this.placingText) {
        this.beginText(this.paperPoint(scenePoint))
        return
      }
      if (!this.drawing) return
      const object = this.drawTo(scenePoint, true)
      this.cancelPlacement()
      if (!object) return
      if (object.type !== 'stroke') {
        this.pendingSelection = [object.id]
        this.returnToSelect()
      }
      events.commit([{ type: 'create', object }])
    })
    const notifySelection = () => {
      if (this.syncing) return
      const active = canvas.getActiveObject()
      if (active instanceof ActiveSelection) active.set({ hasControls: false })
      events.selection(this.selectedIds())
    }
    canvas.on('selection:created', notifySelection)
    canvas.on('selection:updated', notifySelection)
    canvas.on('selection:cleared', notifySelection)
    canvas.on('object:moving', ({ target }) => {
      if (target instanceof ActiveSelection) this.keepGroupOnPaper(target)
      else this.keepOnPaper(target)
    })
    canvas.on('object:modified', ({ target, transform }) => {
      if (this.syncing || !transform) return // IText also emits a modification on edit exit, without a transform.
      const grouped = target instanceof ActiveSelection
      const members = grouped ? target.getObjects() : [target]
      const commands = members.flatMap((view): SceneCommand[] => {
        const id = this.ids.get(view)
        const data = id ? this.objects.get(id)?.data : undefined
        if (!id || !data) return []
        const center = grouped ? view.getCenterPoint() : this.keepOnPaper(view)
        const { x, y } = view instanceof Polyline ? center.subtract(pathOffset(view)) : center
        const changes: ObjectChanges = { x, y }
        if (!grouped) {
          changes.rotation = view.angle
          if (view.scaleX !== 1 || view.scaleY !== 1) {
            if (data.type === 'rectangle' || data.type === 'ellipse') {
              changes.width = data.width * view.scaleX
              changes.height = data.height * view.scaleY
            } else if (data.type === 'text') {
              changes.fontSize = data.fontSize * view.scaleX
            } else if (data.type === 'stroke') {
              changes.points = data.points.map(p => ({ x: p.x * view.scaleX, y: p.y * view.scaleY }))
            } else {
              changes.dx = data.dx * view.scaleX
              changes.dy = data.dy * view.scaleY
            }
          }
        }
        return [{ type: 'update', id, changes }]
      })
      this.events.commit(commands)
    })
    canvas.on('text:editing:entered', ({ target }) => this.trackEditing(target))
    canvas.on('text:changed', ({ target }) => {
      if (target !== this.editing || !this.editingCenter) return
      // Fabric expands an IText from its top edge, while the project stores the center.
      target.setPositionByOrigin(this.editingCenter, 'center', 'center')
      target.setCoords()
      if (target.hiddenTextarea) target.updateTextareaPosition()
    })
    canvas.on('text:editing:exited', ({ target }) => this.commitText(target))
  }

  private paperPoint(point: Point) {
    return new Point(Math.max(0, Math.min(paperWidth, point.x)), Math.max(0, Math.min(paperHeight, point.y)))
  }

  private drawTo(point: Point, ending = false) {
    const drawing = this.drawing!
    const next = this.paperPoint(point)
    if (drawing.type === 'stroke') {
      const last = drawing.points[drawing.points.length - 1]
      const distance = Math.hypot(next.x - last.x, next.y - last.y)
      if (distance >= 2 || (ending && drawing.points.length > 1 && distance > 0)) drawing.points.push(next)
    } else {
      drawing.points[1] = next
    }
    return shapeFromGesture(drawing.id, drawing.type, drawing.points)
  }

  private keepOnPaper(object: FabricObject) {
    const center = object.getCenterPoint()
    const next = this.paperPoint(center)
    if (!next.eq(center)) {
      object.setPositionByOrigin(next, 'center', 'center')
      object.setCoords()
    }
    return next
  }

  private keepGroupOnPaper(group: ActiveSelection) {
    let minX = -Infinity, minY = -Infinity, maxX = Infinity, maxY = Infinity
    for (const object of group.getObjects()) {
      const { x, y } = object.getCenterPoint()
      minX = Math.max(minX, -x); maxX = Math.min(maxX, paperWidth - x)
      minY = Math.max(minY, -y); maxY = Math.min(maxY, paperHeight - y)
    }
    const dx = minX <= maxX ? Math.max(minX, Math.min(0, maxX)) : 0
    const dy = minY <= maxY ? Math.max(minY, Math.min(0, maxY)) : 0
    if (dx || dy) group.setPositionByOrigin(group.getCenterPoint().add(new Point(dx, dy)), 'center', 'center')
  }

  private selectedIds() {
    return this.canvas.getActiveObjects().flatMap(object => {
      const id = this.ids.get(object)
      return id ? [id] : []
    })
  }

  selectOnRender(ids: readonly string[]) {
    this.pendingSelection = ids
  }

  previewProperties(id: string, changes: ObjectChanges) {
    const object = this.objects.get(id)
    if (!object || this.editing || this.canvas.getActiveObject() !== object.view) return false
    const preview = { ...object.data, ...changes }
    if (!isCanvasObject(preview)) return false
    // Only update the Fabric view here. The finished edit goes through the command history.
    paintObject(object.view, preview)
    this.canvas.requestRenderAll()
    return true
  }

  setTool(tool: Tool) {
    if (this.tool === tool) return
    this.cancelPlacement()
    this.tool = tool
    this.canvas.selection = tool === 'select'
    this.canvas.skipTargetFind = tool !== 'select'
    this.canvas.defaultCursor = tool === 'select' ? 'default' : 'crosshair'
    if (tool !== 'select') {
      this.canvas.discardActiveObject()
      this.canvas.requestRenderAll()
    }
  }

  private cancelPlacement() {
    if (this.drawing?.preview) this.canvas.remove(this.drawing.preview)
    this.drawing = undefined
    this.placingText = false
  }

  private returnToSelect() {
    this.setTool('select')
    this.events.tool('select')
  }

  private beginText({ x, y }: Point) {
    this.returnToSelect()
    const data: TextObject = { id: crypto.randomUUID(), type: 'text', x, y, rotation: 0, text: '', ...textStyle }
    const object = new IText('', { ...textStyle, originX: 'center', originY: 'center', left: x, top: y, fill: data.color })
    this.draft = { id: data.id, object, data }
    this.ids.set(object, data.id)
    this.canvas.add(object)
    this.canvas.setActiveObject(object)
    object.enterEditing()
  }

  private trackEditing(object: IText) {
    this.editing = object
    this.editingCenter = object.getCenterPoint()
    this.textBeforeEdit = object.text
    this.events.editing(true)
    const textarea = object.hiddenTextarea
    if (!textarea) return
    textarea.addEventListener('compositionstart', () => {
      this.composition = { value: textarea.value, start: textarea.selectionStart, end: textarea.selectionEnd }
    })
    textarea.addEventListener('compositionend', event => {
      // Fabric marks editing as ended before blurring the textarea. A candidate
      // finalized by that blur must not overwrite the last confirmed value.
      if (!object.isEditing) return
      const before = this.composition
      this.composition = undefined
      if (event.data !== '' || !before || textarea.value === before.value) return
      textarea.value = before.value
      textarea.setSelectionRange(before.start, before.end)
      textarea.dispatchEvent(new Event('input'))
    })
    // Leave composing keys to the OS; Fabric otherwise treats Escape as edit exit and handles arrows itself.
    textarea.addEventListener('keydown', event => {
      if (event.isComposing || this.composition) event.stopImmediatePropagation()
    }, { capture: true })
  }

  private commitText(object: IText) {
    const text = this.composition?.value ?? object.text
    this.composition = undefined
    this.editing = undefined
    const center = this.editingCenter
    this.editingCenter = undefined
    this.events.editing(false)
    if (text !== object.text) {
      object.set('text', text)
      if (center) object.setPositionByOrigin(center, 'center', 'center')
      object.setCoords()
    }
    const id = this.ids.get(object)
    if (!id || this.syncing) return
    const draft = this.draft
    if (draft?.object === object) {
      this.draft = undefined
      if (!text.trim()) {
        // Fabric may still be clearing the current selection inside its event dispatch.
        queueMicrotask(() => { if (!this.canvas.destroyed) this.canvas.remove(object) })
        return
      }
      const data = { ...draft.data, text }
      this.objects.set(id, { type: 'text', view: object, data })
      this.events.commit([{ type: 'create', object: data }])
    } else {
      this.events.commit([{ type: 'update', id, changes: { text } }])
    }
  }

  finishEditing() {
    this.editing?.exitEditing()
  }

  isComposing() {
    return this.composition !== undefined
  }

  hasPendingText() {
    if (!this.editing) return false
    const text = this.composition?.value ?? this.editing.text
    return this.draft?.object === this.editing ? !!text.trim() : text !== this.textBeforeEdit
  }

  resetInteraction() {
    this.finishEditing()
    this.cancelPlacement()
    this.pendingSelection = undefined
    this.syncing = true
    try {
      // Fabric terminates an active object's transform while discarding its selection.
      this.canvas.discardActiveObject()
    } finally {
      this.syncing = false
    }
    this.events.selection([])
    this.returnToSelect()
    this.canvas.requestRenderAll()
  }

  render(scene: CanvasScene) {
    this.syncing = true
    try {
      const canvas = this.canvas
      const active = canvas.getActiveObject()
      const selected = this.pendingSelection ?? this.selectedIds()
      if (active instanceof ActiveSelection || (active && this.pendingSelection)) canvas.discardActiveObject()
      this.pendingSelection = undefined
      const ids = new Set(scene.objects.map(({ id }) => id))
      for (const [id, { view }] of this.objects) {
        if (!ids.has(id)) {
          canvas.remove(view)
          this.objects.delete(id)
        }
      }
      scene.objects.forEach((data, index) => {
        const previous = this.objects.get(data.id)
        let object = previous?.view
        if (!object || previous?.type !== data.type) {
          if (object) canvas.remove(object)
          object = data.type === 'text' ? new IText(data.text) : makeShape(data.type)
          this.ids.set(object, data.id)
          canvas.add(object)
        }
        this.objects.set(data.id, { type: data.type, view: object, data })
        object.set({ originX: 'center', originY: 'center', left: data.x, top: data.y, angle: data.rotation,
          transparentCorners: false, cornerSize: 10, lockScalingFlip: true, minScaleLimit: .02,
          lockSkewingX: true, lockSkewingY: true, scaleX: 1, scaleY: 1 })
        const sides = object instanceof Rect || object instanceof Ellipse
        object.setControlsVisibility({ mtr: true, ml: sides, mr: sides, mt: sides, mb: sides })
        paintObject(object, data)
        canvas.moveObjectTo(object, index)
      })
      const targets = selected.flatMap(id => {
        const object = this.objects.get(id)?.view
        return object ? [object] : []
      })
      if (targets.length > 1) canvas.setActiveObject(new ActiveSelection(targets, { canvas, hasControls: false }))
      else if (targets[0] && targets[0] !== canvas.getActiveObject()) canvas.setActiveObject(targets[0])
      this.events.selection(this.selectedIds())
      canvas.requestRenderAll()
    } finally {
      this.syncing = false
    }
  }

  setSelectionColors(accent: string, handle: string) {
    for (const { view: object } of this.objects.values()) {
      object.set({ borderColor: accent, cornerStrokeColor: accent, cornerColor: handle })
      if (object instanceof IText) object.set({ editingBorderColor: accent, cursorColor: accent })
    }
    const active = this.canvas.getActiveObject()
    if (active instanceof ActiveSelection) active.set({ borderColor: accent })
    this.canvas.requestRenderAll()
  }

  dispose() {
    this.resize.disconnect()
    void this.canvas.dispose()
  }
}
