import { useState } from 'react'
import { isConnector } from '../core/connections'
import type { CanvasObject } from '../core/scene'
import { Icon } from './Icon'

export const objectKinds = {
  rectangle: { label: '矩形', icon: 'rect' },
  ellipse: { label: '椭圆', icon: 'ellipse' },
  square: { label: '正方形', icon: 'square' },
  diamond: { label: '菱形', icon: 'diamond' },
  star: { label: '五角星', icon: 'star' },
  line: { label: '直线', icon: 'line' },
  arrow: { label: '箭头', icon: 'arrow' },
  polyline: { label: '折线', icon: 'line' },
  polylineArrow: { label: '折线箭头', icon: 'arrow' },
  curve: { label: '曲线', icon: 'line' },
  curveArrow: { label: '曲线箭头', icon: 'arrow' },
  stroke: { label: '笔迹', icon: 'pen' },
  text: { label: '文字', icon: 'text' },
} as const

export type ObjectKind = keyof typeof objectKinds
export function objectKind(object: CanvasObject): ObjectKind {
  if (!isConnector(object) || !object.path) return object.type
  return object.type === 'line' ? object.path.kind : object.path.kind === 'polyline' ? 'polylineArrow' : 'curveArrow'
}

export function ObjectNavigator({ objects, selected, editing, onSelect, onLocate }: {
  objects: readonly CanvasObject[]; selected: ReadonlySet<string>; editing: boolean
  onSelect: (ids: readonly string[], extend: boolean) => void; onLocate: (id: string) => void
}) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<ObjectKind>>(() => new Set())
  const groups = new Map<ObjectKind, CanvasObject[]>()
  for (const object of objects) {
    const kind = objectKind(object), members = groups.get(kind)
    if (members) members.push(object)
    else groups.set(kind, [object])
  }

  function toggle(type: ObjectKind) {
    setCollapsed(previous => {
      const next = new Set(previous)
      if (!next.delete(type)) next.add(type)
      return next
    })
  }

  return <section aria-labelledby="content-heading">
    <div className="object-head"><h2 id="content-heading">项目内容</h2><span>{objects.length} 个对象</span></div>
    <div className="canvas-entry"><Icon name="page" />当前画布</div>
    {groups.size === 0 ? <p className="object-empty">暂无对象</p> : (
      <ul className="object-list" aria-label="画布对象">
        {(Object.keys(objectKinds) as ObjectKind[]).map(type => {
          const members = groups.get(type)
          if (!members) return null
          const { label, icon } = objectKinds[type]
          const expanded = !collapsed.has(type), groupId = `object-group-${type}`
          const count = members.filter(object => selected.has(object.id)).length
          const pressed = count === 0 ? false : count === members.length ? true : 'mixed'
          return <li key={type} role="presentation" className="object-group">
            <div className="object-group-head">
              <button type="button" className="group-toggle" aria-label={`${expanded ? '折叠' : '展开'}${label}分组`}
                aria-expanded={expanded} aria-controls={groupId} onClick={() => toggle(type)}><Icon name="chevron" /></button>
              <button type="button" className="group-select" aria-label={`选中全部${label}`} aria-pressed={pressed}
                onClick={event => onSelect(members.map(({ id }) => id), event.shiftKey)}>
                <Icon name={icon} /><span>{label}</span><small>{members.length}</small>
              </button>
            </div>
            <ul className="object-group-items" role="group" aria-label={`${label}条目`} id={groupId} hidden={!expanded}>
              {members.map((object, index) => {
                const name = `${label} ${index + 1}`
                const active = selected.has(object.id)
                const title = object.type === 'text' && object.text.trim() ? object.text.trim().split('\n')[0] : name
                return <li key={object.id} className={active ? 'object-row active' : 'object-row'}>
                  <button type="button" className="object-select" aria-label={`选中${name}`} title={title} aria-pressed={active}
                    onClick={event => onSelect([object.id], event.shiftKey)}>
                    <span>{title}</span>{active && <small>{editing ? '编辑中' : '已选中'}</small>}
                  </button>
                  <button type="button" className="object-locate" aria-label={`定位${name}`} title={`定位${name}`}
                    onClick={() => onLocate(object.id)}><Icon name="locate" /></button>
                </li>
              })}
            </ul>
          </li>
        })}
      </ul>
    )}
  </section>
}
