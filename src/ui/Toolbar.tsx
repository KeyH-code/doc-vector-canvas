import type { Tool } from '../editor/FabricSurface'
import { Icon } from './Icon'

const tools = [
  ['select', 'pointer', '选择'],
  ['rectangle', 'rect', '矩形'],
  ['ellipse', 'ellipse', '椭圆'],
  ['line', 'line', '直线'],
  ['arrow', 'arrow', '箭头'],
  ['stroke', 'pen', '画笔'],
  ['text', 'text', '文字'],
] as const

export function Toolbar({ tool, onTool, onUndo, onRedo, canUndo, canRedo }: {
  tool: Tool
  onTool: (tool: Tool) => void
  onUndo: () => void
  onRedo: () => void
  canUndo: boolean
  canRedo: boolean
}) {
  return (
    <div className="toolstrip" role="group" aria-label="绘图工具">
      {tools.map(([value, icon, label]) => (
        <button type="button" className="tool" key={value} aria-pressed={tool === value} onClick={() => onTool(value)}>
          <span className="tool-icon"><Icon name={icon} /></span>{label}
        </button>
      ))}
      <span className="separator" aria-hidden="true" />
      <div className="history" role="group" aria-label="编辑历史">
        <button type="button" disabled={!canUndo} onClick={onUndo}><Icon name="undo" />撤销</button>
        <button type="button" disabled={!canRedo} onClick={onRedo}><Icon name="redo" />重做</button>
      </div>
    </div>
  )
}
