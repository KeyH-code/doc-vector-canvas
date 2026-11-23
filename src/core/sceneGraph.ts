import { atWorld, bindingKey, connectionResolver, ends, indexObjects, isConnector, textFrameSize, type Endpoint, type EndpointBinding } from './connections'
import type { DocumentPage } from './document'
import { polygonVertices, strokePoints, type ScenePoint } from './geometry'
import type { ImageAsset } from './imageAssets'
import { pathArrowhead } from './linePaths'
import type { CanvasObject, CanvasScene, LineObject } from './scene'

export type SceneAddress = Readonly<{ projectId: string; pageId: string | null }>
type Size = Readonly<{ width: number; height: number }>
export type ScenePage = SceneAddress & Readonly<{ number: number; size: Size | null; kind: 'canvas' | 'pdf' | 'pptx' }>
export type ConnectionRelation = Readonly<{ connectorId: string; targetId: string; end: Endpoint;
  direction: 'out' | 'in' | 'undirected'; binding: EndpointBinding }>
type Bounds = Readonly<{ left: number; top: number; right: number; bottom: number }>
type Placement = 'inside' | 'boundary' | 'outside' | 'unbounded' | 'unknown'
type Source = Readonly<{ kind: 'pdf' | 'pptx'; locked: true; text: { status: 'available'; provenance: 'stored'; value: string } | { status: 'unavailable' } }>

export function listScenePages(project: CanvasScene): readonly ScenePage[] {
  const document = project.document
  return document ? document.pages.map((page, index) => ({ projectId: project.id, pageId: page.id, number: index + 1,
    size: { width: page.width, height: page.height }, kind: document.source.kind }))
    : [{ projectId: project.id, pageId: null, number: 1, size: null, kind: 'canvas' }]
}

export function locateScene(project: CanvasScene, address: SceneAddress): { scene: CanvasScene; page?: DocumentPage } | undefined {
  if (project.id !== address.projectId) return
  if (!project.document) return address.pageId === null ? { scene: project } : undefined
  const page = project.document.pages.find(item => item.id === address.pageId)
  return page && { scene: page.scene, page }
}

/** Direction is relative to the bound host, not inferred from overlap or a connected line's host. */
export function explicitConnections(objects: readonly CanvasObject[]): readonly ConnectionRelation[] {
  const relations: ConnectionRelation[] = []
  for (const line of objects) {
    if (!isConnector(line)) continue
    for (const end of ends) {
      const binding = line[bindingKey[end]]
      if (binding) relations.push({ connectorId: line.id, targetId: binding.targetId, end,
        direction: line.type === 'line' ? 'undirected' : end === 'start' ? 'out' : 'in', binding: { ...binding } })
    }
  }
  return relations
}

function boundsOf(object: CanvasObject): Bounds | null {
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity
  const point = (local: ScenePoint) => {
    const { x, y } = atWorld(object, local)
    left = Math.min(left, x); right = Math.max(right, x)
    top = Math.min(top, y); bottom = Math.max(bottom, y)
  }
  let padding = 'strokeWidth' in object ? object.strokeWidth / 2 : 0
  if (isConnector(object) && object.path) {
    point(object.path.start)
    for (const part of object.path.segments) {
      // The control hull includes the whole cubic, but can overestimate its reach.
      point(part.to)
      if ('c1' in part) { point(part.c1); point(part.c2) }
    }
    if (object.type === 'arrow') for (const local of pathArrowhead(object.path)) point(local)
  } else if (isConnector(object) || object.type === 'stroke') {
    for (const local of strokePoints(object)) point(local)
  } else if (object.type === 'diamond' || object.type === 'star') {
    for (const local of polygonVertices(object.type, object.width, object.height)) point(local)
  } else {
    if (object.type !== 'text' && !('width' in object)) return null
    const { width, height } = object.type === 'text' ? textFrameSize(object) : object
    // Rectangles have mitered corners, so include the stroke in their local frame before rotating.
    const miter = object.type === 'rectangle' || object.type === 'square' ? padding : 0
    for (const x of [-width / 2 - miter, width / 2 + miter]) for (const y of [-height / 2 - miter, height / 2 + miter]) point({ x, y })
    padding -= miter
  }
  const result = { left: left - padding, top: top - padding, right: right + padding, bottom: bottom + padding }
  return Object.values(result).every(Number.isFinite) ? result : null
}

function placement(bounds: Bounds | null, page?: Size): Placement {
  if (!page) return 'unbounded'
  if (!bounds) return 'unknown'
  if (bounds.right < 0 || bounds.bottom < 0 || bounds.left > page.width || bounds.top > page.height) return 'outside'
  return bounds.left >= 0 && bounds.top >= 0 && bounds.right <= page.width && bounds.bottom <= page.height ? 'inside' : 'boundary'
}

/** Detached snapshot of one page. No asset payloads, viewport, or inferred connections. */
export function readSceneGraph(project: CanvasScene, address: SceneAddress) {
  const located = locateScene(project, address)
  if (!located) return
  const { scene, page } = located, kind = project.document?.source.kind
  const text = page?.text
  const source: Source | null = page && kind ? { kind, locked: true,
    text: text ? { status: 'available', provenance: 'stored', value: text } : { status: 'unavailable' } } : null
  const resolver = connectionResolver(indexObjects(scene.objects))
  const connectors: { id: string; path: 'straight' | 'polyline' | 'curve'; directed: boolean;
    endpoints: ReturnType<typeof resolver.endpoints>; geometry: LineObject }[] = []
  const objects = scene.objects.map(object => {
    let projected: CanvasObject = object
    if (isConnector(object)) {
      const geometry = resolver.display(object)
      projected = geometry
      connectors.push({ id: object.id, path: object.path?.kind ?? 'straight', directed: object.type === 'arrow',
        endpoints: resolver.endpoints(object), geometry })
    }
    const bounds = boundsOf(projected)
    return { record: object, bounds, placement: placement(bounds, page) }
  })
  const images: Omit<ImageAsset, 'data'>[] = (scene.images ?? []).map(({ id, mime, width, height }) => ({ id, mime, width, height }))
  return structuredClone({ address: { projectId: address.projectId, pageId: address.pageId },
    size: page ? { width: page.width, height: page.height } : null, source, objects, connectors,
    relations: explicitConnections(scene.objects), images })
}
