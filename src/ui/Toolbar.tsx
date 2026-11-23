import { useEffect, useRef, useState } from 'react'
import type { Tool } from '../editor/FabricSurface'
import { Icon } from './Icon'
import { objectKinds } from './ObjectNavigator'

const tools = [
  ['rectangle', 'rect', '矩形'],
  ['ellipse', 'ellipse', '椭圆'],
  ['stroke', 'pen', '画笔'],
  ['text', 'text', '文字'],
] as const
const extraShapes = ['square', 'diamond', 'star'] as const

function ToolMenu({ label, id, icon, options, active, onTool }: {
  label: string; id: string; icon: 'diamond' | 'line' | 'arrow'; options: readonly (Tool & keyof typeof objectKinds)[]
  active: Tool; onTool: (tool: Tool) => void
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null), toggle = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    function close(event: PointerEvent) {
      if (!(event.target instanceof Node) || !root.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])
  return <div className="extra-shapes" ref={root} onKeyDown={event => {
    if (event.key !== 'Escape' || !open) return
    event.preventDefault()
    setOpen(false); toggle.current?.focus()
  }}>
    <button type="button" className="tool" ref={toggle} aria-expanded={open} aria-controls={id}
      aria-pressed={options.some(value => value === active)} onClick={() => setOpen(value => !value)}>
      <span className="tool-icon"><Icon name={icon} /></span>{label}
    </button>
    <div className="extra-shape-options" id={id} role="group" aria-label={`${label}选项`} hidden={!open}>
      {options.map(type => <button type="button" key={type} onClick={() => {
        onTool(type); setOpen(false); toggle.current?.focus()
      }}><Icon name={objectKinds[type].icon} />{type === 'arrow' ? '直线箭头' : objectKinds[type].label}</button>)}
    </div>
  </div>
}

export function Toolbar({ tool, hand, snap, editing, onTool, onHand, onSnap, onUndo, onRedo, canUndo, canRedo, onImage, imageBusy }: {
  tool: Tool
  hand: boolean
  snap: boolean
  editing: boolean
  onTool: (tool: Tool) => void
  onHand: () => void
  onSnap: () => void
  onUndo: () => void
  onRedo: () => void
  canUndo: boolean
  canRedo: boolean
  onImage: (file: File) => void
  imageBusy: boolean
}) {
  const imageInput = useRef<HTMLInputElement>(null)
  return (
    <div className="toolstrip" role="group" aria-label="绘图工具">
      <button type="button" className="tool" aria-pressed={tool === 'select' && !hand} onClick={() => onTool('select')}>
        <span className="tool-icon"><Icon name="pointer" /></span>选择
      </button>
      <button type="button" className="tool" aria-pressed={hand} disabled={editing} onClick={onHand}
        title="拖动视图；也可按住空格临时使用">
        <span className="tool-icon"><Icon name="hand" /></span>抓手
      </button>
      {tools.map(([value, icon, label]) => (
        <button type="button" className="tool" key={value} aria-pressed={tool === value} onClick={() => onTool(value)}>
          <span className="tool-icon"><Icon name={icon} /></span>{label}
        </button>
      ))}
      <ToolMenu label="线条" id="line-tools" icon="line" options={['line', 'polyline', 'curve']} active={tool} onTool={onTool} />
      <ToolMenu label="箭头" id="arrow-tools" icon="arrow" options={['arrow', 'polylineArrow', 'curveArrow']} active={tool} onTool={onTool} />
      <ToolMenu label="其他图形" id="extra-shapes" icon="diamond" options={extraShapes} active={tool} onTool={onTool} />
      <button type="button" className="tool" aria-label="插入图片" disabled={imageBusy || editing} onClick={() => imageInput.current?.click()}>
        <span className="tool-icon"><Icon name="image" /></span>图片
      </button>
      <input type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" hidden ref={imageInput} onChange={event => {
        const file = event.currentTarget.files?.[0]
        event.currentTarget.value = ''
        if (file) onImage(file)
      }} />
      <button type="button" className="tool" aria-pressed={snap} disabled={editing} onClick={onSnap}
        title="开启后，线条和箭头的端点可吸附到对象外框或路径">
        <span className="tool-icon"><Icon name="snap" /></span>端点吸附
      </button>
      <span className="separator" aria-hidden="true" />
      <div className="history" role="group" aria-label="编辑历史">
        <button type="button" disabled={!canUndo} onClick={onUndo}><Icon name="undo" />撤销</button>
        <button type="button" disabled={!canRedo} onClick={onRedo}><Icon name="redo" />重做</button>
      </div>
    </div>
  )
}
