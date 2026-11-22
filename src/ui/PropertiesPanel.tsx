import { useLayoutEffect, useRef } from 'react'
import type { ObjectChanges } from '../core/commands'
import type { CanvasObject } from '../core/scene'

const fonts = [
  ['Microsoft YaHei, sans-serif', '微软雅黑'],
  ['SimSun, serif', '宋体'],
] as const

const displayNumber = (value: number) => String(Number(value.toFixed(2)))

function ColorField({ label, value, disabled, onPreview, onFinish }: {
  label: string; value: string; disabled?: boolean; onPreview: (value: string) => void; onFinish: () => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  useLayoutEffect(() => {
    const input = ref.current!
    // The native picker emits input while adjusting, then change on confirmation.
    const preview = () => onPreview(input.value)
    const finish = () => { preview(); onFinish() }
    input.addEventListener('input', preview)
    input.addEventListener('change', finish)
    return () => {
      input.removeEventListener('input', preview)
      input.removeEventListener('change', finish)
    }
  }, [onPreview, onFinish])
  return <label>{label}<input key={value} ref={ref} type="color" defaultValue={value} disabled={disabled} /></label>
}

function NumberField({ label, value, min, max, onPreview, onFinish }: {
  label: string; value: number; min: number; max: number; onPreview: (value: number) => void; onFinish: () => void
}) {
  const lastValid = useRef<number>(undefined)
  return <label>{label}<input key={value} type="number" defaultValue={value} min={min} max={max} step="any"
    onFocus={() => { lastValid.current = undefined }}
    onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }}
    onInput={event => {
      const input = event.currentTarget
      const next = input.valueAsNumber
      if (!input.validity.valid || !Number.isFinite(next)) return
      lastValid.current = next
      onPreview(next)
    }}
    onBlur={event => {
      event.currentTarget.value = String(lastValid.current ?? value)
      lastValid.current = undefined
      onFinish()
    }} /></label>
}

export function PropertiesPanel({ object, onChange, onPreview, onFinish }: {
  object: CanvasObject; onChange: (changes: ObjectChanges) => void; onPreview: (changes: ObjectChanges) => void; onFinish: () => void
}) {
  return <section className="properties" aria-labelledby="properties-heading">
    <h2 id="properties-heading">对象属性</h2>
    <dl className="property-summary">
      <div><dt>位置 X, Y</dt><dd>{displayNumber(object.x)}, {displayNumber(object.y)}</dd></div>
      <div><dt>旋转</dt><dd>{displayNumber(object.rotation)}°</dd></div>
      {'width' in object && <div><dt>宽 × 高</dt><dd>{displayNumber(object.width)} × {displayNumber(object.height)}</dd></div>}
      {'dx' in object && <div><dt>长度</dt><dd>{displayNumber(Math.hypot(object.dx, object.dy))}</dd></div>}
      {'points' in object && <div><dt>笔迹点数</dt><dd>{object.points.length}</dd></div>}
    </dl>
    <div className="property-fields">
      {object.type === 'text' ? <>
        <label>字体<select value={object.fontFamily} onChange={e => onChange({ fontFamily: e.currentTarget.value })}>
          {!fonts.some(([value]) => value === object.fontFamily) && <option value={object.fontFamily}>{object.fontFamily}</option>}
          {fonts.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <NumberField key={object.id + ':fontSize'} label="字号" value={object.fontSize} min={8} max={240}
          onPreview={fontSize => onPreview({ fontSize })} onFinish={onFinish} />
        <ColorField label="文字颜色" value={object.color} onPreview={color => onPreview({ color })} onFinish={onFinish} />
      </> : <>
        {(object.type === 'rectangle' || object.type === 'ellipse') && <>
          <ColorField label="填充颜色" value={object.fill === 'transparent' ? '#e0eaf3' : object.fill}
            disabled={object.fill === 'transparent'} onPreview={fill => onPreview({ fill })} onFinish={onFinish} />
          <label className="property-check"><input type="checkbox" checked={object.fill === 'transparent'}
            onChange={e => onChange({ fill: e.currentTarget.checked ? 'transparent' : '#e0eaf3' })} />无填充</label>
        </>}
        <ColorField label="描边颜色" value={object.stroke} onPreview={stroke => onPreview({ stroke })} onFinish={onFinish} />
        <NumberField key={object.id + ':strokeWidth'} label="线宽" value={object.strokeWidth} min={0} max={96}
          onPreview={strokeWidth => onPreview({ strokeWidth })} onFinish={onFinish} />
        <label>线型<select value={object.strokeStyle ?? 'solid'} onChange={e => onChange({ strokeStyle: e.currentTarget.value === 'dashed' ? 'dashed' : 'solid' })}>
          <option value="solid">实线</option><option value="dashed">虚线</option>
        </select></label>
      </>}
    </div>
  </section>
}
