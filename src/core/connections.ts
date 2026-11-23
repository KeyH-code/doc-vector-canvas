import { polygonVertices, type ScenePoint } from './geometry'
import { interpolate, movePathEnds, pathEnd, pointOnPart, projectParameter, type CubicPart, type StraightPart } from './linePaths'
import type { BoxObject, CanvasObject, ImageObject, LineObject, TextObject } from './scene'

export type Endpoint = 'start' | 'end'
export type EdgeBinding = Readonly<{ targetId: string; kind: 'edge'; edge: number; t: number }>
export type EllipseBinding = Readonly<{ targetId: string; kind: 'ellipse'; angle: number }>
export type PathBinding = Readonly<{ targetId: string; kind: 'path'; segment: number; t: number }>
export type EndpointBinding = EdgeBinding | EllipseBinding | PathBinding
export type Endpoints = Readonly<Record<Endpoint, ScenePoint>>
type Candidate = Readonly<{ point: ScenePoint; binding: EndpointBinding }>
type ObjectLookup = Pick<ReadonlyMap<string, CanvasObject>, 'get'>

export const ends = ['start', 'end'] as const
export const bindingKey = { start: 'startBinding', end: 'endBinding' } as const

export function isConnector(object: CanvasObject): object is LineObject {
  return object.type === 'line' || object.type === 'arrow'
}

export function hasBinding(object: CanvasObject): object is LineObject & ({ startBinding: EndpointBinding } | { endBinding: EndpointBinding }) {
  return isConnector(object) && !!(object.startBinding || object.endBinding)
}

export function indexObjects(objects: readonly CanvasObject[]) {
  return new Map(objects.map(object => [object.id, object]))
}

const finite = ({ x, y }: ScenePoint) => Number.isFinite(x) && Number.isFinite(y)

export function rotate(point: ScenePoint, angle: number): ScenePoint {
  const rad = (angle % 360) * Math.PI / 180
  const cos = Math.cos(rad), sin = Math.sin(rad)
  return { x: point.x * cos - point.y * sin, y: point.x * sin + point.y * cos }
}

export function atWorld(object: Pick<CanvasObject, 'x' | 'y' | 'rotation'>, point: ScenePoint): ScenePoint {
  const result = rotate(point, object.rotation)
  return { x: object.x + result.x, y: object.y + result.y }
}

export function atLocal(object: Pick<CanvasObject, 'x' | 'y' | 'rotation'>, point: ScenePoint): ScenePoint {
  return rotate({ x: point.x - object.x, y: point.y - object.y }, -object.rotation)
}

function boundaryVertices(host: BoxObject | ImageObject): readonly ScenePoint[] {
  if (host.type === 'diamond' || host.type === 'star') return polygonVertices(host.type, host.width, host.height)
  if (host.type === 'ellipse') return []
  const x = host.width / 2, y = host.height / 2
  return [{ x: -x, y: -y }, { x, y: -y }, { x, y }, { x: -x, y }]
}

export function textFrameSize(text: TextObject) {
  if (text.anchorSize) return text.anchorSize
  const rows = text.text.split(/\r?\n/)
  const units = (value: string) => Array.from(value).reduce((sum, char) => sum + (/\p{Mark}/u.test(char) ? 0 : char.codePointAt(0)! > 255 ? 1 : 'MW@%'.includes(char) ? .86 : 'ilI.,! '.includes(char) ? .3 : .56), 0)
  return { width: rows.reduce((max, row) => Math.max(max, units(row)), .6) * text.fontSize,
    height: (1.13 + (rows.length - 1) * 1.31) * text.fontSize }
}

function textFrame(text: TextObject): BoxObject {
  return { ...text, ...textFrameSize(text), type: 'rectangle', fill: 'transparent', stroke: text.color, strokeWidth: 0 }
}

function pathPart(host: CanvasObject, index: number, display: (line: LineObject) => LineObject | undefined): { from: ScenePoint; part: StraightPart | CubicPart; object: CanvasObject } | undefined {
  if (host.type === 'stroke') {
    const from = host.points[index], to = host.points[index + 1]
    if (from && to) return { from, part: { id: index, to }, object: host }
  } else if (isConnector(host)) {
    const object = display(host)
    if (!object) return
    if (!object.path) {
      if (index === 0) return { from: { x: -object.dx / 2, y: -object.dy / 2 },
        part: { id: 0, to: { x: object.dx / 2, y: object.dy / 2 } }, object }
      return
    }
    const part = object.path.segments[index]
    if (part?.id === index) return { from: index ? object.path.segments[index - 1].to : object.path.start, part, object }
  }
}

export function resolveBinding(binding: EndpointBinding, host: CanvasObject | undefined, display: (line: LineObject) => LineObject | undefined = line => line) {
  if (!host) return
  if (binding.kind === 'path') {
    const value = pathPart(host, binding.segment, display)
    if (!value) return
    const point = atWorld(value.object, pointOnPart(value.from, value.part, binding.t))
    return finite(point) ? point : undefined
  }
  const shape = host.type === 'text' ? textFrame(host) : host
  if (!('width' in shape)) return
  let local: ScenePoint
  if (binding.kind === 'ellipse') {
    if (shape.type !== 'ellipse') return
    local = { x: Math.cos(binding.angle) * (shape.width / 2), y: Math.sin(binding.angle) * (shape.height / 2) }
  } else {
    const vertices = boundaryVertices(shape)
    const a = vertices[binding.edge]
    if (!a) return
    local = interpolate(a, vertices[(binding.edge + 1) % vertices.length], binding.t)
  }
  const point = atWorld(host, local)
  return finite(point) ? point : undefined
}

export function invalidConnector(objects: readonly CanvasObject[]): LineObject | undefined {
  const resolver = connectionResolver(indexObjects(objects))
  return objects.find((object): object is LineObject => hasBinding(object) && !resolver.strict(object))
}

function freeEndpoint(line: LineObject, end: Endpoint) {
  if (line.path) return atWorld(line, end === 'start' ? line.path.start : pathEnd(line.path))
  const sign = end === 'start' ? -1 : 1
  return atWorld(line, { x: sign * (line.dx / 2), y: sign * (line.dy / 2) })
}

export function connectionResolver(lookup: ObjectLookup) {
  const memo = new Map<string, Endpoints | null>()
  function strict(line: LineObject): Endpoints | undefined {
    const stack = [{ line, next: 0 }], active = new Set([line.id])
    while (stack.length) {
      const frame = stack.at(-1)!, { line: item } = frame
      if (memo.has(item.id)) { stack.pop(); active.delete(item.id); continue }
      if (frame.next < ends.length) {
        const binding = item[bindingKey[ends[frame.next++]]]
        const host = binding && lookup.get(binding.targetId)
        if (host && isConnector(host) && !memo.has(host.id)) {
          if (active.has(host.id)) memo.set(host.id, null)
          else { active.add(host.id); stack.push({ line: host, next: 0 }) }
        }
        continue
      }
      const point = (end: Endpoint) => {
        const binding = item[bindingKey[end]]
        return binding ? resolveBinding(binding, lookup.get(binding.targetId), host => {
          const endpoints = memo.get(host.id)
          return endpoints ? (hasBinding(host) ? { ...host, ...endpointGeometry(host, endpoints) } : host) : undefined
        }) : freeEndpoint(item, end)
      }
      const start = point('start'), end = point('end')
      memo.set(item.id, start && end && finite(start) && finite(end) && Number.isFinite(end.x - start.x) && Number.isFinite(end.y - start.y) ? { start, end } : null)
    }
    return memo.get(line.id) ?? undefined
  }
  const endpoints = (line: LineObject) => strict(line) ?? { start: freeEndpoint(line, 'start'), end: freeEndpoint(line, 'end') }
  const display = (line: LineObject) => hasBinding(line) ? { ...line, ...endpointGeometry(line, endpoints(line)) } : line
  return { strict, endpoints, display }
}

export function resolveEndpoints(line: LineObject, objects: readonly CanvasObject[] | ObjectLookup): Endpoints {
  const lookup = 'get' in objects ? objects : indexObjects(objects)
  return connectionResolver(lookup).endpoints(line)
}

export function validConnector(line: LineObject, get: (id: string) => CanvasObject | undefined) {
  return !!connectionResolver({ get: id => id === line.id ? line : get(id) }).strict(line)
}

export function segmentGeometry({ start, end }: Endpoints) {
  return { x: start.x / 2 + end.x / 2, y: start.y / 2 + end.y / 2, dx: end.x - start.x, dy: end.y - start.y, rotation: 0 }
}

export function endpointGeometry(line: LineObject, endpoints: Endpoints) {
  if (!line.path) return segmentGeometry(endpoints)
  const start = atLocal(line, endpoints.start), end = atLocal(line, endpoints.end)
  return { path: movePathEnds(line.path, start, end), dx: end.x - start.x, dy: end.y - start.y }
}

export function connectorForDisplay(line: LineObject, objects: ObjectLookup): LineObject {
  return connectionResolver(objects).display(line)
}

/** Rebase the free geometry at the current visible endpoints; unaffected bindings retain their local coordinates. */
export function detachEndpoints(line: LineObject, objects: ObjectLookup, detach: (binding: EndpointBinding, end: Endpoint) => boolean): LineObject {
  const { startBinding, endBinding, ...rest } = line
  return { ...rest, ...endpointGeometry(line, resolveEndpoints(line, objects)),
    ...(startBinding && !detach(startBinding, 'start') ? { startBinding } : {}),
    ...(endBinding && !detach(endBinding, 'end') ? { endBinding } : {}) }
}

export function captureSelection(objects: readonly CanvasObject[], ids: readonly string[]): CanvasObject[] {
  const selected = new Set(ids)
  const lookup = indexObjects(objects)
  const external = (binding: EndpointBinding) => !selected.has(binding.targetId)
  return structuredClone(objects.filter(object => selected.has(object.id)).map(object =>
    hasBinding(object) && ends.some(end => {
      const binding = object[bindingKey[end]]
      return binding && external(binding)
    }) ? detachEndpoints(object, lookup, external) : object))
}

export function offsetCopies(objects: readonly CanvasObject[], allocateId: (id: string) => string, offset: ScenePoint): CanvasObject[] {
  const ids = new Map(objects.map(({ id }) => [id, allocateId(id)]))
  return objects.map(object => {
    const placement = { id: ids.get(object.id)!, x: object.x + offset.x, y: object.y + offset.y }
    if (!isConnector(object)) return { ...object, ...placement }
    const { startBinding, endBinding, ...line } = object
    // captureSelection removes external bindings and preserves the world positions they resolved to.
    const rebind = (binding?: EndpointBinding) => {
      if (!binding) return
      const targetId = ids.get(binding.targetId)
      if (targetId) return { ...binding, targetId }
    }
    const start = rebind(startBinding), end = rebind(endBinding)
    return { ...line, ...placement, ...(start ? { startBinding: start } : {}), ...(end ? { endBinding: end } : {}) }
  })
}

function distance(a: ScenePoint, b: ScenePoint) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

// Closest point in the first quadrant: solve the monotone normal equation outside or inside the ellipse.
function closestEllipseAngle(point: ScenePoint, rx: number, ry: number) {
  const swap = rx < ry, major = swap ? ry : rx, minor = swap ? rx : ry
  const px = swap ? point.y : point.x, py = swap ? point.x : point.y
  const a = Math.abs(px) / major, b = Math.abs(py) / major, r = minor / major
  let u: number, v: number
  if (a === 0) { u = 0; v = 1 }
  else if (b === 0) {
    u = Math.min(1, a / (1 - r * r))
    v = Math.sqrt(1 - u * u)
  } else {
    // Parameter is shifted by r² to avoid cancellation near the short axis.
    let low = r * b, high = Math.hypot(a, low)
    for (let i = 0; i < 52; i++) {
      const mid = (low + high) / 2
      if (Math.hypot(a / (mid + (1 - r * r)), r * b / mid) > 1) low = mid
      else high = mid
    }
    u = a / (high + (1 - r * r)); v = r * b / high
  }
  u *= px < 0 ? -1 : 1
  v *= py < 0 ? -1 : 1
  return swap ? Math.atan2(u, v) : Math.atan2(v, u)
}

function dependsOn(host: CanvasObject, id: string, lookup: ObjectLookup) {
  const pending = [host], seen = new Set<string>()
  while (pending.length) {
    const item = pending.pop()!
    if (item.id === id) return true
    if (seen.has(item.id) || !hasBinding(item)) continue
    seen.add(item.id)
    for (const end of ends) {
      const binding = item[bindingKey[end]], next = binding && lookup.get(binding.targetId)
      if (next) pending.push(next)
    }
  }
  return false
}

function closestParameter(from: ScenePoint, part: StraightPart | CubicPart, point: ScenePoint) {
  if (!('c1' in part)) return projectParameter(from, part.to, point)
  const gap = (t: number) => distance(point, pointOnPart(from, part, t))
  let closest = 0, best = gap(0)
  for (let i = 1; i <= 24; i++) {
    const t = i / 24, d = gap(t)
    if (d < best) { closest = t; best = d }
  }
  let lo = Math.max(0, closest - 1 / 24), hi = Math.min(1, closest + 1 / 24)
  for (let i = 0; i < 20; i++) {
    const a = (2 * lo + hi) / 3, b = (lo + 2 * hi) / 3
    if (gap(a) < gap(b)) hi = b
    else lo = a
  }
  const result = (lo + hi) / 2
  return gap(result) < best ? result : closest
}

export function snapToBoundary(objects: readonly CanvasObject[], point: ScenePoint, zoom: number, sourceId?: string): Candidate | undefined {
  if (!finite(point) || !Number.isFinite(zoom) || zoom <= 0) return
  let closest: Candidate | undefined
  let limit = 10 / zoom
  const lookup = indexObjects(objects), resolver = connectionResolver(lookup)
  // Search top to bottom, replacing only with a strictly nearer candidate.
  for (let i = objects.length - 1; i >= 0; i--) {
    const item = objects[i]
    if (sourceId && dependsOn(item, sourceId, lookup)) continue
    function offer(binding: EndpointBinding, position: ScenePoint | undefined) {
      if (!position) return
      const gap = distance(point, position)
      if (gap < limit || (!closest && gap === limit)) {
        limit = gap
        closest = { point: position, binding }
      }
    }
    const host = item.type === 'text' ? textFrame(item) : item
    if (!('width' in host)) {
      if ('strokeWidth' in host && host.strokeWidth === 0) continue
      const object = isConnector(host) ? resolver.display(host) : host
      const count = object.type === 'stroke' ? object.points.length - 1 : isConnector(object) ? object.path?.segments.length ?? 1 : 0
      const local = atLocal(object, point)
      for (let segment = 0; segment < count; segment++) {
        const value = pathPart(object, segment, line => line)
        if (!value) continue
        const { from, part } = value
        const corners = 'c1' in part ? [from, part.to, part.c1, part.c2] : [from, part.to]
        if (local.x < Math.min(...corners.map(p => p.x)) - limit || local.x > Math.max(...corners.map(p => p.x)) + limit ||
            local.y < Math.min(...corners.map(p => p.y)) - limit || local.y > Math.max(...corners.map(p => p.y)) + limit) continue
        const t = closestParameter(from, part, local)
        offer({ targetId: object.id, kind: 'path', segment, t }, atWorld(object, pointOnPart(from, part, t)))
      }
      continue
    }
    const local = atLocal(host, point)
    const rx = host.width / 2, ry = host.height / 2
    if (Math.abs(local.x) > rx + limit || Math.abs(local.y) > ry + limit) continue
    if (host.type === 'ellipse') {
      const binding = { targetId: host.id, kind: 'ellipse', angle: closestEllipseAngle(local, rx, ry) } as const
      offer(binding, resolveBinding(binding, host))
    } else {
      const vertices = boundaryVertices(host)
      vertices.forEach((a, edge) => {
        const b = vertices[(edge + 1) % vertices.length]
        const t = projectParameter(a, b, local)
        offer({ targetId: host.id, kind: 'edge', edge, t }, atWorld(host, interpolate(a, b, t)))
      })
    }
  }
  return closest
}
