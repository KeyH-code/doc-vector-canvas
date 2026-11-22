import { useEffect, useRef, useState, type RefObject } from 'react'

const zoomStops = [.05, .10, .25, .5, .75, 1, 1.25, 1.5, 2, 3, 4, 6, 8]
const percent = (zoom: number) => `${Math.round(zoom * 100)}%`

export function ViewportControls({ editor, editing, zoom, onZoom, onFit }: {
  editor: RefObject<HTMLElement | null>; editing: boolean; zoom: number
  onZoom: (value: number) => void; onFit: () => void
}) {
  const [fullscreen, setFullscreen] = useState(false)
  const [failure, setFailure] = useState(false)
  useEffect(() => {
    const update = () => setFullscreen(document.fullscreenElement === editor.current)
    document.addEventListener('fullscreenchange', update)
    return () => document.removeEventListener('fullscreenchange', update)
  }, [editor])

  async function toggleFullscreen() {
    setFailure(false)
    const target = editor.current
    if (!target) return
    try {
      if (document.fullscreenElement === target) await document.exitFullscreen()
      else await target.requestFullscreen()
    } catch {
      setFailure(true)
    }
  }

  const levels = zoomStops.includes(zoom) ? zoomStops : [...zoomStops, zoom].sort((a, b) => a - b)
  return <div className="viewport-controls" role="group" aria-label="画布视图">
    <select aria-label="画布缩放" value={zoom} onChange={event => onZoom(Number(event.currentTarget.value))} disabled={editing}>
      {levels.map(level => <option key={level} value={level}>{percent(level)}</option>)}
    </select>
    <button type="button" onClick={onFit} disabled={editing}>回到内容</button>
    <button type="button" disabled={!document.fullscreenEnabled} onClick={() => void toggleFullscreen()}>
      {fullscreen ? '退出全屏' : '全屏'}
    </button>
    {failure && <span className="viewport-feedback">当前环境无法进入全屏</span>}
  </div>
}

export function WorkspaceDivider({ width, min, max, onWidth }: {
  width: number; min: number; max: number; onWidth: (width: number) => void
}) {
  const drag = useRef<{ id: number; x: number; width: number }>(null)
  const resize = (value: number) => onWidth(Math.min(max, Math.max(min, value)))
  return <div className="workspace-divider" role="separator" aria-label="调整工作区宽度" aria-orientation="vertical"
    tabIndex={0} aria-valuemin={min} aria-valuemax={max} aria-valuenow={width}
    onPointerDown={event => {
      if (event.button !== 0) return
      drag.current = { id: event.pointerId, x: event.clientX, width }
      event.currentTarget.setPointerCapture(event.pointerId)
    }}
    onPointerMove={event => {
      const start = drag.current
      if (start?.id === event.pointerId) resize(start.width + event.clientX - start.x)
    }}
    onLostPointerCapture={() => { drag.current = null }}
    onKeyDown={event => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      event.preventDefault()
      resize(width + (event.key === 'ArrowLeft' ? -16 : 16))
    }} />
}
