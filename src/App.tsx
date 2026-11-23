import { useLayoutEffect, useRef, useState } from 'react'
import { hasBinding, isConnector } from './core/connections'
import { connectorTool, curveTool } from './editor/FabricSurface'
import { useEditor } from './editor/useEditor'
import { FileMenu } from './ui/FileMenu'
import { DocumentExportDialog } from './ui/DocumentExportDialog'
import { Icon } from './ui/Icon'
import { ObjectNavigator, objectKind, objectKinds } from './ui/ObjectNavigator'
import { PageNavigator } from './ui/PageNavigator'
import { PropertiesPanel } from './ui/PropertiesPanel'
import { Toolbar } from './ui/Toolbar'
import { ViewportControls, WorkspaceDivider } from './ui/ViewportControls'

export function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [expanded, setExpanded] = useState(true)
  const [sidebarWidth, setSidebarWidth] = useState(240)
  const [windowWidth, setWindowWidth] = useState(window.innerWidth)
  const root = useRef<HTMLElement>(null)
  useLayoutEffect(() => { document.documentElement.dataset.theme = theme }, [theme])
  useLayoutEffect(() => {
    const observe = new ResizeObserver(([entry]) => setWindowWidth(Math.floor(entry.contentRect.width)))
    observe.observe(root.current!)
    return () => observe.disconnect()
  }, [])
  const minSidebar = windowWidth < 800 ? 184 : 200
  const maxSidebar = Math.max(minSidebar, Math.min(480, windowWidth - 280))
  const shownSidebar = Math.min(maxSidebar, Math.max(minSidebar, sidebarWidth))
  const editor = useEditor(theme)
  const { scene, tool, selected, editing } = editor
  const single = selected.length === 1 ? selected[0] : undefined
  const selectedIds = new Set(selected.map(object => object.id))
  const size = scene.objects.length
  const status = editing ? '正在编辑文字' : single ? `已选中 1 个${objectKinds[objectKind(single)].label}`
    : selected.length ? `已选中 ${selected.length} 个对象` : `${size} 个对象`
  const hint = editing ? '在画布上输入文字 · 点击空白结束编辑'
    : editor.hand ? '按住拖动画布，只移动视图'
    : editor.continuing === 'bound' ? '点击落点继续折线 · 确认后更新原末端连接 · Esc 取消'
    : editor.continuing ? '点击落点继续折线 · Esc 取消'
    : tool === 'text' ? '点击画布添加文字' : tool === 'stroke' ? '按住拖动绘制 · 松手可继续下一笔'
    : curveTool(tool) ? '按住拖出走向 · 松手生成平滑曲线'
    : editor.snap && connectorTool(tool) ? '拖出线段 · 端点靠近轮廓可吸附'
    : tool !== 'select' ? `在画布上拖出${objectKinds[tool].label}`
    : single?.type === 'text' ? '拖动文字移动 · 双击编辑'
    : single && isConnector(single) && single.path?.kind === 'polyline' ? '点击末端继续折线 · 拖动端点可改接'
    : single && hasBinding(single) ? '拖动圆形端点可改接或解除'
    : single ? '拖动对象移动 · 控制点缩放或旋转'
    : selected.length ? '拖动可整体移动 · Shift 可调整选区' : '先选一个绘图工具'

  return (
    <main ref={root} className="editor" data-sidebar={expanded ? 'expanded' : 'collapsed'}
      style={expanded ? { gridTemplateColumns: `${shownSidebar}px 8px minmax(0, 1fr)` } : undefined} onMouseDownCapture={event => {
      if (!(event.target instanceof Element)) return
      // Keep the IME focused until the clicked action decides whether to end the edit.
      if (editor.isComposing() && event.target.closest('button')) event.preventDefault()
      // Export can read a property preview without blurring and committing its input.
      if (editor.hasPendingProperties() && event.target.closest('.export-action')) event.preventDefault()
    }}>
      <aside className="sidebar" aria-label="项目侧栏">
        <div className="sidebar-head">
          <button type="button" className="sidebar-toggle" aria-controls="sidebar-content" aria-expanded={expanded}
            aria-label={expanded ? '收起侧栏' : '展开侧栏'} onClick={() => setExpanded(!expanded)}><Icon name="sidebar" /></button>
          {expanded && <div className="brand"><span className="logo"><Icon name="logo" /></span>文档矢量画布</div>}
        </div>
        {!expanded && <p className="rail-label" aria-hidden="true">项目</p>}
        <div className="sidebar-inner" id="sidebar-content" hidden={!expanded}>
          <section className="file-panel" aria-label="项目操作">
            <b className="file-name">{editor.projectName}</b>
            <FileMenu busy={editor.reading} openProgress={editor.openProgress} canExport={selected.length > 0 && !editing}
              onSave={editor.saveProject} onNew={editor.newProject} onOpen={editor.openLocalProject} onExport={editor.exportSelection}
              documentKind={editor.document?.source.kind} onDocumentExport={editor.beginDocumentExport}
              canDocumentExport={!editing && !editor.importing} onCancelOpen={editor.cancelOpen} />
          </section>
          <div className="sidebar-scroll">
            {editor.document ? <PageNavigator pages={editor.document.pages} active={editor.pageId} hiddenBackgrounds={editor.hiddenBackgrounds}
              onPage={editor.selectPage} onToggleBackground={editor.togglePageBackground} reader={editor.pageReader}>
              <ObjectNavigator key={scene.id} objects={scene.objects} selected={selectedIds} editing={editing} embedded
                onSelect={editor.selectFromNavigator} onLocate={editor.locateFromNavigator} />
            </PageNavigator> : <ObjectNavigator key={scene.id} objects={scene.objects} selected={selectedIds} editing={editing}
              onSelect={editor.selectFromNavigator} onLocate={editor.locateFromNavigator} />}
          </div>
          {single && !editing && <PropertiesPanel key={single.id} object={single} objects={scene.objects} onLocate={editor.locateFromNavigator}
            onChange={changes => editor.updateProperties(single.id, changes)}
            onPreview={changes => editor.previewProperties(single.id, changes)}
            onFinish={() => editor.finishPropertyPreview(single.id)} />}
          <div className="themes" role="group" aria-label="主题">
            <button type="button" aria-pressed={theme === 'light'} onClick={() => setTheme('light')}><Icon name="sun" />亮色</button>
            <button type="button" aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}><Icon name="moon" />暗色</button>
          </div>
        </div>
      </aside>
      {expanded && <WorkspaceDivider width={shownSidebar} min={minSidebar} max={maxSidebar} onWidth={setSidebarWidth} />}
      <section className="workspace" aria-label="画布工作区">
        <div className="space">
          <div className="stage-head">
            <Toolbar tool={tool} hand={editor.hand} snap={editor.snap} editing={editing} onTool={editor.setTool} onHand={editor.toggleHand} onSnap={editor.toggleSnap}
              onUndo={editor.undo} onRedo={editor.redo}
              canUndo={editor.canUndo} canRedo={editor.canRedo} onImage={editor.importImage} imageBusy={editor.importing || editor.reading} />
            {editor.notice && <div className="notice" role="alert">
              <Icon name="notice" /><span><b>{editor.notice.title}</b> {editor.notice.message}</span>
            </div>}
          </div>
          <div className="sheet-zone">
            <section className="sheet" aria-label="画布">
              <div ref={editor.host} className="canvas-host" data-testid="canvas-stage"><canvas ref={editor.canvas} /></div>
              <span className="sheet-label" aria-hidden="true">{editor.document ? `${editor.document.source.kind.toUpperCase()} / ${String(editor.pageIndex + 1).padStart(2, '0')}` : 'PERSONAL / 01'}</span>
              {!editor.document && size === 0 && tool === 'select' && !editing && <div className="empty">
                <span className="empty-icon"><Icon name="rect" /></span>
                <b>从一张空白画布开始</b><span>选择「矩形」拖出图形，或用「文字」加一行说明。</span>
              </div>}
            </section>
          </div>
        </div>
        <footer className="statusbar">
          <div className="status-meta"><span role="status">{status}</span><span className="separator" aria-hidden="true" /><span>{hint}</span></div>
          <div className="edit-actions" role="group" aria-label="对象操作">
            <button type="button" disabled={editing || !selected.length} onClick={editor.copy}>复制</button>
            <button type="button" disabled={editing || !editor.canPaste} onClick={editor.paste}>粘贴</button>
            <button type="button" disabled={editing || !selected.length} onClick={editor.remove}>删除</button>
          </div>
          <ViewportControls editor={root} editing={editing} zoom={editor.zoom} onZoom={editor.zoomTo} onFit={editor.fitContent} />
        </footer>
      </section>
      {editor.documentExport && <DocumentExportDialog {...editor.documentExport} onDownload={editor.downloadDocument} onClose={editor.closeDocumentExport} />}
    </main>
  )
}
