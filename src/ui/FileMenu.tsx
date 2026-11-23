import { useRef } from 'react'

export function FileMenu({ busy, openProgress, canExport, onSave, onNew, onOpen, onExport, documentKind, onDocumentExport, canDocumentExport, onCancelOpen }: {
  busy: boolean
  openProgress?: string
  canExport: boolean
  onSave: () => void
  onNew: () => void
  onOpen: (file: File) => Promise<void>
  onExport: () => void
  documentKind?: 'pdf' | 'pptx'
  onDocumentExport: () => void
  canDocumentExport: boolean
  onCancelOpen: () => void
}) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <div className="actions" role="group" aria-label="项目文件">
        <button type="button" className="file-save" disabled={busy} onClick={onSave}>保存项目</button>
        <button type="button" disabled={busy} onClick={onNew}>新建</button>
        <button type="button" disabled={busy} onClick={() => input.current?.click()}>打开项目</button>
        <input ref={input} type="file" accept=".json,application/json,.pdf,application/pdf,.pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation" hidden onChange={event => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          if (file) void onOpen(file)
        }} />
      </div>
      {busy && <button type="button" className="export-action" onClick={onCancelOpen}>取消打开</button>}
      {openProgress && <p className="open-progress" aria-live="polite">{openProgress}</p>}
      <button type="button" className="export-action" disabled={busy || !canExport} onClick={onExport}>导出选中 SVG</button>
      {documentKind && <button type="button" className="export-action" disabled={busy || !canDocumentExport}
        onClick={onDocumentExport}>导出 {documentKind.toUpperCase()}</button>}
    </>
  )
}
