import { ActiveSelection, Canvas, Ellipse, IText, Path, Point, Polygon, Polyline, Rect, util, type FabricObject, type Transform } from 'fabric'
import type { ObjectChanges, SceneCommand } from '../core/commands'
import { atLocal, bindingKey, connectionResolver, connectorForDisplay, endpointGeometry, ends, hasBinding, indexObjects, isConnector, resolveEndpoints, segmentGeometry, snapToBoundary,
  type Endpoint, type EndpointBinding, type Endpoints } from '../core/connections'
import { drawingGeometry, type DrawingType, type ScenePoint } from '../core/geometry'
import { appendSegment, distance, fitCurve, makePolyline, mapLinePath, maxPathSegments, pathEnd, pathLength, snappedCurveSamples, type PolylinePath } from '../core/linePaths'
import { isCanvasObject, type BoxObject, type CanvasObject, type CanvasScene, type ImageObject, type LineObject, type TextObject } from '../core/scene'
import { ImageView, applySceneObject, makeSceneObject, makeShape, paintObject, paintShape, pathOffset, type Shape, type ShapeView } from './fabricObjects'
import { fitViewport, initialViewport, panViewport, viewportMatrix, viewToWorld, worldToView, zoomViewport, type Viewport } from './viewport'

type PolylineTool = 'polyline' | 'polylineArrow'
type CurveTool = 'curve' | 'curveArrow'
type DrawTool = DrawingType | PolylineTool | CurveTool
export type Tool = 'select' | 'text' | DrawTool
const polylineTool = (tool: Tool): tool is PolylineTool => tool === 'polyline' || tool === 'polylineArrow'
export const curveTool = (tool: Tool): tool is CurveTool => tool === 'curve' || tool === 'curveArrow'
export const connectorTool = (tool: Tool) => tool === 'line' || tool === 'arrow' || polylineTool(tool) || curveTool(tool)
export type Continuation = 'free' | 'bound'

const rectangleStyle = { fill: '#e0eaf3', stroke: '#6381a2', strokeWidth: 2 }
const strokeStyle = { stroke: '#547798', strokeWidth: 4 }
const textStyle = { fontFamily: 'Microsoft YaHei, sans-serif', fontSize: 34, color: '#797b82' }
const endpointRadius = 8
type EndpointDrag = { id: number; end: Endpoint; line: LineObject; initial: Endpoints; origin: ScenePoint;
  preview: Endpoints; binding?: EndpointBinding; moved: boolean }

function selectionDelta(target: FabricObject, transform: Transform) {
  return { x: target.left - transform.original.left, y: target.top - transform.original.top }
}

function translateFreeEnd(line: LineObject, delta: ScenePoint) {
  return { x: line.x + delta.x, y: line.y + delta.y }
}

function scaledBox(data: BoxObject | ImageObject, view: FabricObject) {
  const width = data.width * view.scaleX
  return { width, height: data.type === 'square' ? width : data.height * view.scaleY }
}

function shapeFromGesture(id: string, type: DrawTool, points: readonly ScenePoint[], zoom = 1): Shape | undefined {
  if (curveTool(type)) {
    const start = points[0], end = points.at(-1)!
    const geometry = segmentGeometry({ start, end })
    const path = fitCurve(points.map(p => atLocal(geometry, p)), 2.5 / zoom)
    if (!path || pathLength(path) * zoom < 4) return
    return { id, type: type === 'curve' ? 'line' : 'arrow', ...strokeStyle, ...geometry, path }
  }
  if (polylineTool(type)) {
    if (points.length < 2 || distance(points[0], points[1]) < 4) return
    const geometry = segmentGeometry({ start: points[0], end: points[1] })
    const path = makePolyline(atLocal(geometry, points[0]), atLocal(geometry, points[1]))!
    return { id, type: type === 'polyline' ? 'line' : 'arrow', ...strokeStyle, ...geometry, path }
  }
  const geometry = drawingGeometry(type, points)
  if (!geometry) return
  const common = { id, rotation: 0 }
  if ('width' in geometry) {
    if (geometry.width < 4 || geometry.height < 4) return
    const { type, ...box } = geometry
    const data = { ...common, ...rectangleStyle, ...box, type }
    if (isCanvasObject(data)) return data
    return
  }
  if ('dx' in geometry && Math.hypot(geometry.dx, geometry.dy) < 4) return
  return { ...common, ...strokeStyle, ...geometry }
}

export class FabricSurface {
  private readonly canvas: Canvas
  private readonly resize: ResizeObserver
  private readonly listeners = new AbortController()
  private viewport?: Viewport
  private size = { width: 1, height: 1 }
  private hand = false
  private temporaryHand = false
  private pan?: { id: number; x: number; y: number }
  private snap = false
  private candidate?: ScenePoint
  private endpointDrag?: EndpointDrag
  private extension?: { line: LineObject & { path: PolylinePath }; point?: ScenePoint }
  private extensionPress?: { id: number; origin: ScenePoint; moved: boolean }
  private transforming = false
  private accent = '#355985'
  private handle = '#fffdf9'
  private sceneObjects: readonly CanvasObject[] = []
  private snapTargets: readonly CanvasObject[] = []
  private sceneIndex = indexObjects([])
  private readonly objects = new Map<string, { type: CanvasObject['type']; data: CanvasObject; view: FabricObject }>()
  private readonly ids = new WeakMap<FabricObject, string>()
  private tool: Tool = 'select'
  private drawing?: { id: string; type: DrawTool; points: ScenePoint[]; startBinding?: EndpointBinding; preview?: ShapeView }
  private placingText = false
  private draft?: { id: string; object: IText; data: TextObject }
  private editing?: IText
  private editingCenter?: Point
  private textBeforeEdit = ''
  private composition?: { value: string; start: number; end: number }
  private pendingSelection?: readonly string[]
  private syncing = false
  private activePointer?: number
  private idleWaiters: (() => void)[] = []

  constructor(element: HTMLCanvasElement, host: HTMLElement, private readonly events: {
    commit: (commands: readonly SceneCommand[]) => void
    selection: (ids: string[]) => void
    tool: (tool: Tool) => void
    editing: (editing: boolean) => void
    zoom: (zoom: number) => void
    continuing: (state?: Continuation) => void
  }) {
    const canvas = this.canvas = new Canvas(element, { enablePointerEvents: true, selection: true, selectionKey: 'shiftKey', uniScaleKey: null,
      preserveObjectStacking: true, targetFindTolerance: 7 })
    this.resize = new ResizeObserver(([entry]) => {
      const width = Math.floor(entry.contentRect.width)
      const height = Math.floor(entry.contentRect.height)
      if (width < 1 || height < 1) return
      this.size = { width, height }
      canvas.setDimensions({ width, height })
      this.showViewport(this.viewport ?? initialViewport(this.size))
    })
    this.resize.observe(host)
    const layer = canvas.upperCanvasEl
    const signal = this.listeners.signal
    layer.addEventListener('pointerdown', event => {
      if (event.isPrimary && event.button === 0) this.activePointer = event.pointerId
      if (this.editing || !event.isPrimary || event.button !== 0) return
      if (!this.hand && !this.temporaryHand) {
        if (this.extension) {
          event.preventDefault()
          event.stopImmediatePropagation()
          this.extensionPress = { id: event.pointerId, origin: { x: event.clientX, y: event.clientY }, moved: false }
          layer.setPointerCapture(event.pointerId)
          return
        }
        if (!this.startEndpointDrag(event)) return
        event.preventDefault()
        event.stopImmediatePropagation()
        layer.setPointerCapture(event.pointerId)
        return
      }
      event.preventDefault()
      event.stopImmediatePropagation()
      this.pan = { id: event.pointerId, x: event.clientX, y: event.clientY }
      layer.setPointerCapture(event.pointerId)
      this.showCursor()
    }, { signal, capture: true })
    layer.addEventListener('pointermove', event => {
      if (this.extensionPress?.id === event.pointerId) {
        event.stopImmediatePropagation()
        this.extensionPress.moved ||= distance(this.extensionPress.origin, { x: event.clientX, y: event.clientY }) >= 4
        if (this.extension) this.updateExtension(this.canvas.getScenePoint(event))
        return
      }
      if (this.endpointDrag?.id === event.pointerId) {
        event.stopImmediatePropagation()
        this.moveEndpoint(event)
        return
      }
      const previous = this.pan
      if (!previous || previous.id !== event.pointerId || !this.viewport) return
      event.stopImmediatePropagation()
      this.pan = { id: previous.id, x: event.clientX, y: event.clientY }
      this.showViewport(panViewport(this.viewport, { x: event.clientX - previous.x, y: event.clientY - previous.y }))
    }, { signal, capture: true })
    const endPan = (event: PointerEvent) => {
      const press = this.extensionPress
      if (press?.id === event.pointerId) {
        event.stopImmediatePropagation()
        this.extensionPress = undefined
        const releasedAt = { x: event.clientX, y: event.clientY }
        if (this.extension && event.type === 'pointerup' && !press.moved && distance(press.origin, releasedAt) < 4) {
          this.updateExtension(this.canvas.getScenePoint(event), true)
        }
        this.releasePointer(event.pointerId)
        return
      }
      if (this.endpointDrag?.id === event.pointerId) {
        event.stopImmediatePropagation()
        if (event.type === 'pointerup') this.moveEndpoint(event)
        this.finishEndpointDrag(event.type === 'pointerup')
        this.releasePointer(event.pointerId)
        return
      }
      if (this.pan?.id !== event.pointerId) return
      event.stopImmediatePropagation()
      this.pan = undefined
      this.showCursor()
      this.releasePointer(event.pointerId)
    }
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) layer.addEventListener(name, endPan, { signal, capture: true })
    // Uncaptured gestures finish in Fabric's document handler before bubbling to window.
    for (const name of ['pointerup', 'pointercancel'] as const) {
      window.addEventListener(name, event => this.releasePointer(event.pointerId), { signal })
    }
    window.addEventListener('blur', () => this.releasePointer(), { signal })
    layer.addEventListener('pointerleave', () => {
      if (!this.drawing && !this.endpointDrag) this.showCandidate()
    }, { signal })
    layer.addEventListener('wheel', event => {
      if ((!event.ctrlKey && !event.metaKey) || !this.viewport || this.editing || this.pan || this.drawing || this.endpointDrag) return
      event.preventDefault()
      const bounds = layer.getBoundingClientRect()
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.size.height : 1
      const delta = Math.max(-500, Math.min(500, event.deltaY * unit))
      this.showViewport(zoomViewport(this.viewport, this.size, { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
        this.viewport.zoom * Math.exp(-delta * .002)))
    }, { signal, passive: false })

    canvas.on('mouse:down', ({ e, scenePoint }) => {
      if ('button' in e && e.button !== 0) return
      if (this.tool === 'text') this.placingText = true
      if (this.tool === 'select' || this.tool === 'text' || this.drawing) return
      const start = connectorTool(this.tool) ? this.snapPoint(scenePoint) : undefined
      this.drawing = { id: crypto.randomUUID(), type: this.tool, points: [start?.point ?? scenePoint], startBinding: start?.binding }
    })
    canvas.on('mouse:move', ({ scenePoint, viewportPoint }) => {
      if (this.extension && !this.hand && !this.temporaryHand) { this.updateExtension(scenePoint); return }
      const drawing = this.drawing
      if (!drawing) {
        if (!this.hand && !this.temporaryHand && connectorTool(this.tool)) this.showCandidate(this.snapPoint(scenePoint)?.point)
        if (this.endpointAt(viewportPoint)) canvas.setCursor('crosshair')
        return
      }
      const data = this.drawTo(scenePoint)
      if (!data) {
        if (drawing.preview) canvas.remove(drawing.preview)
        drawing.preview = undefined
        return
      }
      if (!drawing.preview) {
        drawing.preview = makeShape(data.type, 'path' in data ? data.path : undefined)
        drawing.preview.set({ originX: 'center', originY: 'center', selectable: false, evented: false })
        canvas.add(drawing.preview)
      }
      drawing.preview.set({ left: data.x, top: data.y })
      paintShape(drawing.preview, data)
      canvas.requestRenderAll()
    })
    canvas.on('mouse:up', ({ e, scenePoint }) => {
      if ('button' in e && e.button !== 0) return
      if (this.transforming) {
        this.transforming = false
        canvas.requestRenderAll()
      }
      if (this.tool === 'text' && this.placingText) {
        this.beginText(scenePoint)
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
      if (active instanceof ActiveSelection) this.configureSelection(active)
      events.selection(this.selectedIds())
    }
    canvas.on('selection:created', notifySelection)
    canvas.on('selection:updated', notifySelection)
    canvas.on('selection:cleared', notifySelection)
    for (const name of ['object:moving', 'object:scaling', 'object:rotating'] as const) {
      canvas.on(name, ({ target, transform }) => {
        this.transforming = true
        this.refreshConnections(target, transform)
      })
    }
    canvas.on('after:render', ({ ctx }) => { if (ctx === canvas.getContext()) this.drawEndpointIndicators(ctx) })
    canvas.on('object:modified', ({ target, transform }) => {
      if (this.syncing || !transform) return // IText also emits a modification on edit exit, without a transform.
      const grouped = target instanceof ActiveSelection
      const members = grouped ? target.getObjects() : [target]
      const commands = members.flatMap((view): SceneCommand[] => {
        const id = this.ids.get(view)
        const data = id ? this.objects.get(id)?.data : undefined
        if (!id || !data) return []
        if (hasBinding(data)) {
          if (!grouped || (data.startBinding && data.endBinding)) return []
          return [{ type: 'update', id, changes: translateFreeEnd(data, selectionDelta(target, transform)) }]
        }
        return [{ type: 'update', id, changes: this.transformChanges(data, view, grouped) }]
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
      const id = this.ids.get(target), data = id && this.sceneIndex.get(id)
      if (data && data.type === 'text') this.refreshRelated([{ ...data, text: target.text,
        anchorSize: { width: target.width, height: target.height } }])
    })
    canvas.on('text:editing:exited', ({ target }) => this.commitText(target))
  }

  private showViewport(view: Viewport) {
    const previous = this.viewport
    this.candidate = undefined
    this.viewport = view
    this.canvas.setViewportTransform(viewportMatrix(view, this.size))
    this.canvas.getActiveObject()?.setCoords()
    if (previous?.zoom !== view.zoom) this.events.zoom(view.zoom)
  }

  resetViewport() {
    this.showViewport(initialViewport(this.size))
  }

  setZoom(zoom: number) {
    if (this.viewport) this.showViewport(zoomViewport(this.viewport, this.size, { x: this.size.width / 2, y: this.size.height / 2 }, zoom))
  }

  imagePlacement(width: number, height: number) {
    const zoom = this.viewport?.zoom ?? 1
    const scale = Math.min(1, this.size.width * .6 / (width * zoom), this.size.height * .6 / (height * zoom))
    return { ...(this.viewport?.center ?? { x: 500, y: 296 }), width: width * scale, height: height * scale }
  }

  whenIdle() {
    return this.activePointer !== undefined || this.editing
      ? new Promise<void>(resolve => this.idleWaiters.push(resolve)) : undefined
  }

  private releasePointer(id = this.activePointer) {
    if (id !== this.activePointer) return
    this.activePointer = undefined
    this.notifyIdle()
  }

  private notifyIdle() {
    if (this.activePointer !== undefined || this.editing) return
    for (const resolve of this.idleWaiters.splice(0)) resolve()
  }

  fitContent(id?: string) {
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
    for (const [objectId, { view }] of this.objects) {
      if (id !== undefined && objectId !== id) continue
      const box = view.getBoundingRect()
      left = Math.min(left, box.left); top = Math.min(top, box.top)
      right = Math.max(right, box.left + box.width); bottom = Math.max(bottom, box.top + box.height)
    }
    const fit = fitViewport(this.size, { left, top, width: right - left, height: bottom - top })
    if (fit) this.showViewport(fit)
    else if (id === undefined) this.resetViewport()
  }

  private showCursor() {
    const cursor = this.pan ? 'grabbing' : this.hand || this.temporaryHand ? 'grab' : this.tool === 'select' && !this.extension ? 'default' : 'crosshair'
    this.canvas.defaultCursor = cursor
    this.canvas.setCursor(cursor)
  }

  setHand(hand: boolean, temporary = false) {
    if (temporary) this.temporaryHand = hand
    else this.hand = hand
    if (hand) {
      this.finishEndpointDrag(false)
      this.showCandidate()
    }
    this.showCursor()
    this.canvas.requestRenderAll()
  }

  setSnap(snap: boolean) {
    this.snap = snap
    this.showCandidate()
  }

  private snapPoint(point: ScenePoint, sourceId?: string) {
    if (this.snap && this.viewport) return snapToBoundary(this.snapTargets, point, this.viewport.zoom, sourceId)
  }

  private showCandidate(point?: ScenePoint) {
    if (this.candidate?.x === point?.x && this.candidate?.y === point?.y) return
    this.candidate = point
    this.canvas.requestRenderAll()
  }

  private drawTo(point: Point, ending = false) {
    const drawing = this.drawing!
    const snap = connectorTool(drawing.type) ? this.snapPoint(point) : undefined
    const next = snap?.point ?? point
    this.showCandidate(snap?.point)
    if (curveTool(drawing.type)) {
      if (!ending && distance(point, drawing.points.at(-1)!) * (this.viewport?.zoom ?? 1) >= 2) {
        if (drawing.points.length >= maxPathSegments) drawing.points = drawing.points.filter((_, i) => i % 2 === 0)
        drawing.points.push(point)
      }
      const samples = snap ? snappedCurveSamples(drawing.points, point, next) : [...drawing.points, next]
      const shape = shapeFromGesture(drawing.id, drawing.type, samples, this.viewport?.zoom)
      if (!shape || !isConnector(shape)) return
      return { ...shape, ...(drawing.startBinding ? { startBinding: drawing.startBinding } : {}), ...(snap ? { endBinding: snap.binding } : {}) }
    }
    if (drawing.type === 'stroke') {
      const last = drawing.points[drawing.points.length - 1]
      const distance = Math.hypot(next.x - last.x, next.y - last.y)
      if (distance >= 2 || (ending && drawing.points.length > 1 && distance > 0)) drawing.points.push(next)
    } else {
      drawing.points[1] = next
    }
    const shape = shapeFromGesture(drawing.id, drawing.type, drawing.points)
    if (!shape || !isConnector(shape)) return shape
    return { ...shape, ...(drawing.startBinding ? { startBinding: drawing.startBinding } : {}), ...(snap ? { endBinding: snap.binding } : {}) }
  }

  private selectedConnector() {
    const active = this.canvas.getActiveObject()
    const id = active && this.ids.get(active)
    const data = id ? this.objects.get(id)?.data : undefined
    if (data && isConnector(data)) return data
  }

  private endpointPixels(actual: Endpoints) {
    const start = worldToView(this.viewport!, this.size, actual.start), end = worldToView(this.viewport!, this.size, actual.end)
    const overlap = Math.hypot(end.x - start.x, end.y - start.y) < 2 * endpointRadius
    if (!overlap) return { positions: { start, end }, projected: { start, end } }
    // Leave both handles individually reachable even if their logical positions coincide.
    const x = (start.x + end.x) / 2, y = (start.y + end.y) / 2
    return { positions: { start: { x: x - 11, y }, end: { x: x + 11, y } }, projected: { start, end } }
  }

  private endpointAt(point: ScenePoint) {
    if (this.tool !== 'select' || this.hand || this.temporaryHand || this.transforming || !this.viewport) return
    const line = this.selectedConnector()
    if (!line) return
    const actual = resolveEndpoints(line, this.sceneIndex)
    const { positions } = this.endpointPixels(actual)
    let hit: { line: LineObject; end: Endpoint; actual: Endpoints } | undefined
    let nearest = endpointRadius
    for (const end of ends) {
      const pixel = positions[end]
      const gap = Math.hypot(pixel.x - point.x, pixel.y - point.y)
      if (gap <= nearest) { nearest = gap; hit = { line, end, actual } }
    }
    return hit
  }

  private startEndpointDrag(event: PointerEvent) {
    const origin = this.canvas.getViewportPoint(event)
    const hit = this.endpointAt(origin)
    if (!hit) return false
    this.endpointDrag = { id: event.pointerId, line: hit.line, end: hit.end, initial: hit.actual, preview: hit.actual, origin, moved: false }
    this.canvas.setCursor('crosshair')
    return true
  }

  private moveEndpoint(event: PointerEvent) {
    const drag = this.endpointDrag!
    if (!this.viewport) return
    const pixel = this.canvas.getViewportPoint(event)
    drag.moved = Math.hypot(pixel.x - drag.origin.x, pixel.y - drag.origin.y) >= 2
    const point = viewToWorld(this.viewport, this.size, pixel)
    const snap = drag.moved ? this.snapPoint(point, drag.line.id) : undefined
    drag.binding = snap?.binding
    drag.preview = drag.moved ? { ...drag.initial, [drag.end]: snap?.point ?? point } : drag.initial
    const view = this.objects.get(drag.line.id)?.view
    const derived = { ...drag.line, ...endpointGeometry(drag.line, drag.preview), [bindingKey[drag.end]]: drag.binding }
    if (view) applySceneObject(view, derived)
    this.refreshRelated([derived])
    this.showCandidate(snap?.point)
    this.canvas.requestRenderAll()
  }

  private finishEndpointDrag(save: boolean) {
    const drag = this.endpointDrag
    if (!drag) return
    this.endpointDrag = undefined
    this.showCandidate()
    this.showCursor()
    const view = this.objects.get(drag.line.id)?.view
    if (view) applySceneObject(view, connectorForDisplay(drag.line, this.sceneIndex))
    if (drag.moved) this.refreshRelated([drag.line])
    this.canvas.requestRenderAll()
    if (save && drag.moved) {
      const changes = { ...endpointGeometry(drag.line, drag.preview), [bindingKey[drag.end]]: drag.binding }
      this.events.commit([{ type: 'update', id: drag.line.id, changes }])
    } else if (save && drag.end === 'end' && drag.line.path?.kind === 'polyline') {
      this.extension = { line: { ...drag.line, path: drag.line.path } }
      this.events.continuing(drag.line.endBinding ? 'bound' : 'free')
      this.showCursor()
    }
  }

  cancelExtension() {
    if (!this.extension) return false
    this.extension = undefined
    this.events.continuing(undefined)
    this.showCandidate()
    this.showCursor()
    this.canvas.requestRenderAll()
    return true
  }

  private updateExtension(point: ScenePoint, confirm = false) {
    const { line } = this.extension!
    const candidate = this.snapPoint(point, line.id)
    const next = candidate?.point ?? point
    this.extension!.point = next
    this.showCandidate(candidate?.point)
    this.canvas.requestRenderAll()
    if (!confirm) return
    const actual = resolveEndpoints(line, this.sceneIndex)
    if (distance(actual.end, next) < 2 / (this.viewport?.zoom ?? 1)) return
    const current = connectorForDisplay(line, this.sceneIndex).path
    if (current?.kind !== 'polyline') return
    const path = appendSegment(current, atLocal(line, next))
    if (!path) return
    const tip = pathEnd(path)
    this.cancelExtension()
    this.events.commit([{ type: 'update', id: line.id, changes: { path, dx: tip.x - path.start.x, dy: tip.y - path.start.y, endBinding: candidate?.binding } }])
  }

  private drawEndpointIndicators(ctx: CanvasRenderingContext2D) {
    if (!this.viewport || this.hand || this.temporaryHand) return
    const view = this.viewport
    const circle = ({ x, y }: ScenePoint, radius: number, fill: string) => {
      ctx.beginPath()
      ctx.arc(x, y, radius, 0, 2 * Math.PI)
      ctx.fillStyle = fill
      ctx.fill()
      ctx.stroke()
    }
    ctx.save()
    ctx.strokeStyle = this.accent
    ctx.lineWidth = 2
    if (!this.transforming) {
      const line = this.selectedConnector()
      if (line) {
        const actual = this.endpointDrag?.preview ?? resolveEndpoints(line, this.sceneIndex)
        const { positions, projected } = this.endpointPixels(actual)
        for (const end of ends) {
          const point = positions[end], anchor = projected[end]
          if (point !== anchor) {
            ctx.beginPath(); ctx.moveTo(anchor.x, anchor.y); ctx.lineTo(point.x, point.y); ctx.stroke()
          }
          const binding = this.endpointDrag?.end === end && this.endpointDrag.moved ? this.endpointDrag.binding : line[bindingKey[end]]
          circle(point, 4, binding ? this.accent : this.handle)
        }
      }
    }
    if (this.drawing?.startBinding) circle(worldToView(view, this.size, this.drawing.points[0]), 4, this.accent)
    if (this.extension?.point) {
      const from = worldToView(view, this.size, resolveEndpoints(this.extension.line, this.sceneIndex).end)
      const to = worldToView(view, this.size, this.extension.point)
      ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke(); ctx.setLineDash([])
    }
    if (this.candidate) circle(worldToView(view, this.size, this.candidate), 7, this.handle)
    ctx.restore()
  }

  private transformChanges(data: CanvasObject, view: FabricObject, grouped: boolean): ObjectChanges {
    const center = view.getCenterPoint()
    const { x, y } = (view instanceof Polyline && !(view instanceof Polygon)) || view instanceof Path ? center.subtract(pathOffset(view)) : center
    const changes: ObjectChanges = { x, y }
    if (grouped) return changes
    changes.rotation = view.angle
    if (view.scaleX === 1 && view.scaleY === 1) return changes
    if ('width' in data) Object.assign(changes, scaledBox(data, view))
    else if (data.type === 'text') changes.fontSize = data.fontSize * view.scaleX
    else {
      const scale = (p: ScenePoint) => ({ x: p.x * view.scaleX, y: p.y * view.scaleY })
      if (data.type === 'stroke') changes.points = data.points.map(scale)
      else {
        changes.dx = data.dx * view.scaleX
        changes.dy = data.dy * view.scaleY
        if (data.path) changes.path = mapLinePath(data.path, scale)
      }
    }
    return changes
  }

  private refreshRelated(changes: readonly CanvasObject[], carryGroup = false) {
    if (!this.sceneObjects.some(hasBinding)) return
    const updated = indexObjects(changes)
    const resolver = connectionResolver({ get: id => updated.get(id) ?? this.sceneIndex.get(id) })
    for (const data of this.sceneObjects) {
      if (!hasBinding(data)) continue
      const view = this.objects.get(data.id)?.view
      if (!view) continue
      const change = updated.get(data.id)
      if (change && !carryGroup) continue // The actively edited view already displays its preview.
      const world = resolver.display(change && isConnector(change) ? change : data)
      const center = view.group ? new Point(world.x, world.y).transform(util.invertTransform(view.group.calcTransformMatrix())) : world
      applySceneObject(view, { ...world, x: center.x, y: center.y })
    }
  }

  private refreshConnections(target: FabricObject, transform: Transform) {
    if (!this.sceneObjects.some(hasBinding)) return
    const grouped = target instanceof ActiveSelection
    const members = grouped ? target.getObjects() : [target]
    const changes = members.flatMap((view): CanvasObject[] => {
      const id = this.ids.get(view), data = id ? this.sceneIndex.get(id) : undefined
      if (!data) return []
      if (hasBinding(data)) {
        return grouped && (!data.startBinding || !data.endBinding) ? [{ ...data, ...translateFreeEnd(data, selectionDelta(target, transform)) }] : []
      }
      const result = { ...data, ...this.transformChanges(data, view, grouped) }
      if (result.type === 'text' && view instanceof IText) result.anchorSize = { width: view.width * view.scaleX, height: view.height * view.scaleY }
      return [result]
    })
    this.refreshRelated(changes, true)
  }

  private selectedIds() {
    return this.canvas.getActiveObjects().flatMap(object => {
      const id = this.ids.get(object)
      return id ? [id] : []
    })
  }

  private configureSelection(group: ActiveSelection) {
    const fixed = group.getObjects().every(view => {
      const id = this.ids.get(view)
      const data = id ? this.sceneIndex.get(id) : undefined
      return data && isConnector(data) && data.startBinding && data.endBinding
    })
    group.set({ hasControls: false, lockMovementX: fixed, lockMovementY: fixed })
  }

  selectOnRender(ids: readonly string[]) {
    this.pendingSelection = ids
  }

  selectFromNavigator(ids: readonly string[], extend: boolean) {
    this.cancelExtension()
    const selected = new Set(extend ? this.selectedIds() : [])
    const remove = extend && ids.every(id => selected.has(id))
    for (const id of ids) remove ? selected.delete(id) : selected.add(id)
    this.applySelection([...selected])
  }

  private applySelection(ids: readonly string[]) {
    const active = this.canvas.getActiveObject()
    const targets = ids.flatMap(id => {
      const object = this.objects.get(id)?.view
      return object ? [object] : []
    })
    const syncing = this.syncing
    this.syncing = true
    try {
      if (targets.length !== 1 || targets[0] !== active) {
        this.canvas.discardActiveObject()
        if (targets.length > 1) {
          const group = new ActiveSelection(targets, { canvas: this.canvas, borderColor: targets[0].borderColor })
          this.configureSelection(group)
          this.canvas.setActiveObject(group)
        }
        else if (targets[0]) this.canvas.setActiveObject(targets[0])
      }
    } finally {
      this.syncing = syncing
    }
    this.events.selection(this.selectedIds())
    this.canvas.requestRenderAll()
  }

  previewProperties(id: string, changes: ObjectChanges) {
    const object = this.objects.get(id)
    if (!object || this.editing || this.canvas.getActiveObject() !== object.view) return false
    const preview = { ...object.data, ...changes }
    if (!isCanvasObject(preview)) return false
    // Only update the Fabric view here. The finished edit goes through the command history.
    paintObject(object.view, isConnector(preview) ? connectorForDisplay(preview, this.sceneIndex) : preview)
    this.refreshRelated([preview.type === 'text' && object.view instanceof IText
      ? { ...preview, anchorSize: { width: object.view.width, height: object.view.height } } : preview])
    this.canvas.requestRenderAll()
    return true
  }

  setTool(tool: Tool) {
    if (this.tool === tool) return
    this.cancelPlacement()
    this.tool = tool
    this.canvas.selection = tool === 'select'
    this.canvas.skipTargetFind = tool !== 'select'
    this.showCursor()
    if (tool !== 'select') {
      this.canvas.discardActiveObject()
      this.canvas.requestRenderAll()
    }
  }

  private cancelPlacement() {
    this.cancelExtension()
    if (this.drawing?.preview) this.canvas.remove(this.drawing.preview)
    this.drawing = undefined
    this.placingText = false
    this.finishEndpointDrag(false)
    this.showCandidate()
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
    this.notifyIdle()
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
    this.releasePointer()
    this.transforming = false
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
    this.cancelExtension()
    this.finishEndpointDrag(false)
    this.sceneObjects = scene.objects
    this.sceneIndex = indexObjects(scene.objects)
    this.syncing = true
    try {
      const canvas = this.canvas
      const active = canvas.getActiveObject()
      const selected = this.pendingSelection ?? this.selectedIds()
      if (active instanceof ActiveSelection || (active && this.pendingSelection)) canvas.discardActiveObject()
      this.pendingSelection = undefined
      const ids = new Set(scene.objects.map(({ id }) => id))
      const resolver = connectionResolver(this.sceneIndex)
      const images = new Map((scene.images ?? []).map(asset => [asset.id, asset]))
      for (const [id, { view }] of this.objects) {
        if (!ids.has(id)) {
          canvas.remove(view)
          this.objects.delete(id)
        }
      }
      scene.objects.forEach((data, index) => {
        const previous = this.objects.get(data.id)
        let object = previous?.view
        if (!object || previous?.type !== data.type || (object instanceof Path) !== (isConnector(data) && !!data.path) ||
            (data.type === 'image' && (!(object instanceof ImageView) || object.asset !== images.get(data.assetId)))) {
          if (object) canvas.remove(object)
          object = makeSceneObject(data, images)
          this.ids.set(object, data.id)
          canvas.add(object)
        }
        this.objects.set(data.id, { type: data.type, view: object, data })
        const attached = hasBinding(data)
        object.set({
          transparentCorners: false, cornerSize: 10, lockScalingFlip: true, minScaleLimit: .02,
          lockSkewingX: true, lockSkewingY: true, hasControls: !attached, hasBorders: !attached,
          lockMovementX: attached, lockMovementY: attached })
        const sides = data.type !== 'square' && (object instanceof Rect || object instanceof Ellipse || object instanceof Polygon)
        object.setControlsVisibility({ mtr: true, ml: sides, mr: sides, mt: sides, mb: sides })
        applySceneObject(object, isConnector(data) ? resolver.display(data) : data)
        canvas.moveObjectTo(object, index)
      })
      // Legacy text remains byte-compatible on open. Use its measured outline for a new snap.
      this.snapTargets = scene.objects.map(data => {
        if (data.type !== 'text' || data.anchorSize) return data
        const view = this.objects.get(data.id)?.view
        return view instanceof IText ? { ...data, anchorSize: { width: view.width, height: view.height } } : data
      })
      this.applySelection(selected)
    } finally {
      this.syncing = false
    }
  }

  setSelectionColors(accent: string, handle: string) {
    this.accent = accent
    this.handle = handle
    for (const { view: object } of this.objects.values()) {
      object.set({ borderColor: accent, cornerStrokeColor: accent, cornerColor: handle })
      if (object instanceof IText) object.set({ editingBorderColor: accent, cursorColor: accent })
    }
    const active = this.canvas.getActiveObject()
    if (active instanceof ActiveSelection) active.set({ borderColor: accent })
    this.canvas.requestRenderAll()
  }

  dispose() {
    for (const resolve of this.idleWaiters.splice(0)) resolve()
    this.listeners.abort()
    this.resize.disconnect()
    void this.canvas.dispose()
  }
}
