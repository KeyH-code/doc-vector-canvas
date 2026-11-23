import { ends, isConnector } from '../core/connections'
import type { CanvasObject } from '../core/scene'
import { explicitConnections } from '../core/sceneGraph'
import { Icon } from './Icon'
import { objectKind, objectKinds, type ObjectKind } from './ObjectNavigator'

type Link = { key: string; label: string; target?: string }

export function ConnectionsPanel({ object, objects, onLocate }: {
  object: CanvasObject; objects: readonly CanvasObject[]; onLocate: (id: string) => void
}) {
  const names = new Map<string, string>(), counts = new Map<ObjectKind, number>()
  for (const item of objects) {
    const kind = objectKind(item), count = (counts.get(kind) ?? 0) + 1
    counts.set(kind, count)
    names.set(item.id, `${objectKinds[kind].label} ${count}`)
  }
  const relations = explicitConnections(objects)
  const byLine = new Map<string, Partial<Record<(typeof ends)[number], string>>>()
  for (const { connectorId, targetId, end } of relations) {
    const hosts = byLine.get(connectorId) ?? {}
    hosts[end] = targetId
    byLine.set(connectorId, hosts)
  }
  const links: Link[] = []
  const hosts = byLine.get(object.id)
  if (isConnector(object) && hosts) {
    for (const [index, end] of ends.entries()) {
      links.push({ key: end, label: object.type === 'arrow' ? end === 'start' ? '起点' : '终点' : `端点 ${index + 1}`,
        target: hosts[end] })
    }
  }
  for (const relation of relations) {
    if (relation.targetId !== object.id) continue
    const { connectorId, end } = relation
    const opposite = byLine.get(connectorId)?.[end === 'start' ? 'end' : 'start']
    const direction = relation.direction === 'undirected' ? '连接' : relation.direction === 'out' ? '出向' : '入向'
    links.push({ key: `${connectorId}:${end}`, label: `${direction} · ${names.get(connectorId)}`, target: opposite ?? connectorId })
  }

  return <section className="connections" aria-labelledby="connections-heading">
    <h3 id="connections-heading">连接</h3>
    {links.length === 0 ? <p>暂无连接</p> : <ul>
      {links.map(({ key, label, target }) => <li key={key}>
        <span>{label}</span>
        {target ? <button type="button" aria-label={`定位连接对象 ${names.get(target)}`} onClick={() => onLocate(target)}>
          <Icon name="locate" />{names.get(target)}
        </button> : <span>自由端点</span>}
      </li>)}
    </ul>}
  </section>
}
