import { bindingKey, ends, isConnector } from '../core/connections'
import type { CanvasObject } from '../core/scene'
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
  const links: Link[] = []
  if (isConnector(object)) {
    if (object.startBinding || object.endBinding) for (const [index, end] of ends.entries()) {
      links.push({ key: end, label: object.type === 'arrow' ? end === 'start' ? '起点' : '终点' : `端点 ${index + 1}`,
        target: object[bindingKey[end]]?.targetId })
    }
  }
  for (const line of objects) {
    if (!isConnector(line)) continue
    for (const end of ends) {
      if (line[bindingKey[end]]?.targetId !== object.id) continue
      const opposite = line[bindingKey[end === 'start' ? 'end' : 'start']]?.targetId
      const direction = line.type === 'line' ? '连接' : end === 'start' ? '出向' : '入向'
      links.push({ key: `${line.id}:${end}`, label: `${direction} · ${names.get(line.id)}`, target: opposite ?? line.id })
    }
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
