import { useEffect, useMemo, useRef, useState } from 'react'
import type { DocumentCanvas } from '../core/document'
import type { PdfReader } from '../document/pdfImport'
import { pageRange } from '../export/documentExport'
import { overlayWarnings, previewPdfPage } from '../export/pdfDocument'

export function DocumentExportDialog({ document, reader, current, onDownload, onClose }: {
  document: DocumentCanvas; reader: PdfReader; current: number
  onDownload: (indexes: readonly number[]) => Promise<void>; onClose: () => void
}) {
  const [scope, setScope] = useState<'all' | 'current' | 'range'>('all')
  const [range, setRange] = useState(`${current + 1}`)
  const [preview, setPreview] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [previewError, setPreviewError] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { dialog.current?.showModal() }, [])
  const indexes = useMemo(() => scope === 'all' ? document.pages.map((_, i) => i)
    : scope === 'current' ? [current] : pageRange(range, document.pages.length), [scope, range, document, current])
  const first = indexes?.[0]
  useEffect(() => {
    setPreview(undefined)
    setPreviewError(false)
    if (first === undefined) return
    const controller = new AbortController()
    void previewPdfPage(reader, document.pages[first], first, controller.signal).then(image => {
      if (!controller.signal.aborted) setPreview(image)
    }, () => { if (!controller.signal.aborted) setPreviewError(true) })
    return () => controller.abort()
  }, [document, reader, first])
  const warnings = useMemo(() => indexes?.flatMap(i => {
    const counts = overlayWarnings(document.pages[i])
    return counts.outside || counts.partial ? [{ page: i + 1, ...counts }] : []
  }), [document, indexes])
  return <dialog ref={dialog} className="document-export" aria-labelledby="document-export-title" onCancel={event => {
    event.preventDefault()
    if (!busy) onClose()
  }}>
    <h2 id="document-export-title">导出 PDF</h2>
    <p>只导出原页范围。页外草稿留在项目中，不会自动加页或扩页。</p>
    <div className="document-export-scopes" aria-label="导出范围" role="group">
      <button type="button" disabled={busy} aria-pressed={scope === 'all'} onClick={() => setScope('all')}>整份</button>
      <button type="button" disabled={busy} aria-pressed={scope === 'current'} onClick={() => setScope('current')}>当前页</button>
      <button type="button" disabled={busy} aria-pressed={scope === 'range'} onClick={() => setScope('range')}>指定页码</button>
    </div>
    {scope === 'range' && <label className="document-export-range">页码范围 <input value={range} disabled={busy} onChange={event => setRange(event.target.value)} placeholder="1,3-5" /></label>}
    {!indexes && <p role="alert">页码无效，请输入 1～{document.pages.length}，例如 1,3-5。</p>}
    {indexes && <p>导出 {indexes.length} 页{indexes.length > 1 ? '，按原顺序排列' : ''}。</p>}
    {warnings && warnings.length > 0 && <ul className="document-export-warnings">
      {warnings.map(item => <li key={item.page}>第 {item.page} 页：估计 {item.outside} 个完全在页外，{item.partial} 个跨过页边。</li>)}
    </ul>}
    {first !== undefined && <div className="document-export-preview">{preview ? <img src={preview} alt={`第 ${first + 1} 页导出预览`} />
      : <span>{previewError ? '预览无法显示，可返回检查页面。' : '正在生成首个导出页的预览…'}</span>}</div>}
    {error && <p role="alert">{error}</p>}
    <div className="document-export-actions">
      <button type="button" disabled={busy} onClick={onClose}>返回画布</button>
      <button type="button" disabled={!indexes?.length || busy} onClick={async () => {
        if (!indexes) return
        setBusy(true); setError('')
        try { await onDownload(indexes); onClose() }
        catch (reason) {
          setError(reason instanceof Error && reason.message.startsWith('PDF 编辑层合计')
            ? reason.message : '未生成 PDF；项目没有修改。请缩小导出范围后重试。')
        }
        finally { setBusy(false) }
      }}>{busy ? '正在导出…' : '下载 PDF'}</button>
    </div>
  </dialog>
}
