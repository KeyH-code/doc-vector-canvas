import { useRef } from 'react'

export function FileMenu({ busy, canExport, onSave, onNew, onOpen, onExport }: {
  busy: boolean
  canExport: boolean
  onSave: () => void
  onNew: () => void
  onOpen: (file: File) => Promise<void>
  onExport: () => void
}) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <div className="actions" role="group" aria-label="项目文件">
        <button type="button" className="file-save" disabled={busy} onClick={onSave}>保存项目</button>
        <button type="button" disabled={busy} onClick={onNew}>新建</button>
        <button type="button" disabled={busy} onClick={() => input.current?.click()}>打开项目</button>
        <input ref={input} type="file" accept=".json,application/json" hidden onChange={event => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          if (file) void onOpen(file)
        }} />
      </div>
      <button type="button" className="export-action" disabled={busy || !canExport} onClick={onExport}>导出选中 SVG</button>
    </>
  )
}
