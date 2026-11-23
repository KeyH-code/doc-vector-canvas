import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ObjectChanges, SceneCommand } from '../core/commands'
import { captureSelection, isConnector, offsetCopies } from '../core/connections'
import { changedPage, isPdfDocument, pageScene, type DocumentCanvas, type PdfSource, type PptxSource } from '../core/document'
import { redo, submitPage, undo } from '../core/history'
import { imageAssetBytes, maxProjectImageBytes, type ImageAsset } from '../core/imageAssets'
import type { CanvasObject, CanvasScene } from '../core/scene'
import type { PdfReader } from '../document/pdfImport'
import type { PageReader } from '../document/pageReader'
import { importPptx, pptxMime, preparePptx } from '../document/pptxImport'
import { selectionSvg } from '../export/selectionSvg'
import { exportPdf } from '../export/pdfDocument'
import { exportPptx } from '../export/pptxDocument'
import { downloadLocalFile, downloadLocalProject, readLocalProject } from '../project/localFiles'
import { prepareImage, readImageAsset, sharePreparedImage } from '../project/imageImport'
import { importPdf, preparePdf } from '../project/documentImport'
import { decodeProject, encodeProject } from '../project/projectFile'
import { createProjectSession, isProjectDirty, markProjectSaved, openDecodedProject, type ProjectSession } from '../project/projectSession'
import { editingShortcut, isTemporaryHandKey } from '../ui/shortcuts'
import { FabricSurface, type Continuation, type Tool } from './FabricSurface'
import { measureTextAnchor } from './fabricObjects'

const untitled = '未命名项目'
const discardMessage = '当前项目有未保存的改动。是否放弃改动并继续？'
type PropertyPreview = { id: string; changes: ObjectChanges }
type Clipboard = { objects: readonly CanvasObject[]; images: readonly ImageAsset[] }
type LoadedDocument = { reader: PageReader; first: HTMLCanvasElement; pdfReader?: PdfReader }
type DocumentExport = { current: number } & (
  { kind: 'pdf'; document: DocumentCanvas<PdfSource>; reader: PdfReader } |
  { kind: 'pptx'; document: DocumentCanvas<PptxSource>; reader: PageReader }
)

export function useEditor(theme: 'light' | 'dark') {
  const [session, setSession] = useState(() => createProjectSession(crypto.randomUUID()))
  const sessionRef = useRef(session)
  const [pageId, setPageId] = useState<string>()
  const activePage = useRef<string>(undefined)
  const [hiddenBackgrounds, setHiddenBackgrounds] = useState<ReadonlySet<string>>(() => new Set())
  const [loadedDocument, setLoadedDocument] = useState<LoadedDocument>()
  const [documentExport, setDocumentExport] = useState<DocumentExport>()
  const exportModalOpen = useRef(false)
  const [tool, updateTool] = useState<Tool>('select')
  const [hand, setHand] = useState(false)
  const [snap, setSnap] = useState(false)
  const [continuing, setContinuing] = useState<Continuation>()
  const [zoom, setZoom] = useState(1)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [clipboard, setClipboard] = useState<Clipboard>({ objects: [], images: [] })
  const [editing, setEditing] = useState(false)
  const [projectName, setProjectName] = useState(untitled)
  const [notice, setNotice] = useState<{ title: string; message: string }>()
  const [reading, setReading] = useState(false)
  const [openProgress, setOpenProgress] = useState<string>()
  const [importing, setImporting] = useState(false)
  const projectGeneration = useRef(0)
  const openRequest = useRef(0)
  const openAbort = useRef<AbortController>(undefined)
  const propertyPreview = useRef<PropertyPreview>(undefined)
  const surface = useRef<FabricSurface>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const host = useRef<HTMLDivElement>(null)

  function publish(next: ProjectSession) {
    sessionRef.current = next
    setSession(next)
  }

  function commit(commands: readonly SceneCommand[], select?: readonly string[]) {
    const current = sessionRef.current
    const targetPage = activePage.current
    const objects = pageScene(current.history.scene, targetPage).objects
    const normalized = commands.map(command => {
      if (command.type !== 'update' || !(['text', 'fontFamily', 'fontSize'] as const).some(key => Object.hasOwn(command.changes, key))) return command
      const previous = objects.find(object => object.id === command.id)
      if (previous?.type !== 'text' || !previous.anchorSize || !(['text', 'fontFamily', 'fontSize'] as const).some(key => command.changes[key] !== undefined && command.changes[key] !== previous[key])) return command
      return { ...command, changes: { ...command.changes, anchorSize: measureTextAnchor({ ...previous, ...command.changes }) } }
    })
    const linkedLegacyText = new Set<string>()
    for (const command of normalized) {
      const bindings = command.type === 'create' && isConnector(command.object) ? command.object
        : command.type === 'update' ? command.changes : undefined
      if (bindings?.startBinding) linkedLegacyText.add(bindings.startBinding.targetId)
      if (bindings?.endBinding) linkedLegacyText.add(bindings.endBinding.targetId)
    }
    // Serialize measurements only when the user first links legacy text, in the same undo step.
    const anchorMeasurements: SceneCommand[] = objects.flatMap(object => object.type === 'text' && !object.anchorSize && linkedLegacyText.has(object.id)
      ? [{ type: 'update', id: object.id, changes: { anchorSize: measureTextAnchor(object) } }] : [])
    const result = submitPage(current.history, targetPage, [...anchorMeasurements, ...normalized])
    if (!result.ok || result.history === current.history) return result.ok
    const images = pageScene(result.history.scene, targetPage).images
    if (images) for (const command of commands) {
      if (command.type !== 'add-image-asset') continue
      const image = images.find(asset => asset.id === command.asset.id)
      if (image) sharePreparedImage(command.asset, image)
    }
    if (select) surface.current?.selectOnRender(select)
    publish({ ...current, history: result.history })
    return true
  }

  function finishPropertyPreview(id?: string) {
    if (exportModalOpen.current) return
    const preview = propertyPreview.current
    if (!preview || (id !== undefined && preview.id !== id)) return
    propertyPreview.current = undefined
    commit([{ type: 'update', ...preview }])
  }

  function previewProperties(id: string, changes: ObjectChanges) {
    const previous = propertyPreview.current
    if (previous && (previous.id !== id || Object.keys(previous.changes).some(key => !Object.hasOwn(changes, key)))) {
      finishPropertyPreview()
    }
    if (surface.current?.previewProperties(id, changes)) propertyPreview.current = { id, changes }
  }

  function hasPendingProperties() {
    const preview = propertyPreview.current
    if (!preview) return false
    const object = currentPageScene().objects.find(({ id }) => id === preview.id)
    return !!object && Object.entries(preview.changes).some(([key, value]) => object[key as keyof CanvasObject] !== value)
  }

  useLayoutEffect(() => {
    const editor = new FabricSurface(canvas.current!, host.current!, {
      commit,
      selection: ids => {
        if (ids.length !== 1 || ids[0] !== propertyPreview.current?.id) finishPropertyPreview()
        setSelectedIds(ids)
      },
      tool: updateTool,
      editing: setEditing,
      zoom: setZoom,
      continuing: setContinuing,
    })
    surface.current = editor
    return () => { surface.current = null; editor.dispose() }
  }, [])

  const { scene: project, past, future } = session.history
  const canvasDocument = project.document
  const page = canvasDocument?.pages.find(entry => entry.id === pageId)
  const scene = pageScene(project, pageId)
  const pageWidth = page?.width, pageHeight = page?.height
  const pageIndex = canvasDocument?.pages.findIndex(entry => entry.id === pageId) ?? -1
  const backgroundVisible = pageId === undefined || !hiddenBackgrounds.has(pageId)
  useLayoutEffect(() => {
    surface.current!.setDocumentPage(pageWidth && pageHeight ? { width: pageWidth, height: pageHeight } : undefined)
  }, [project.id, pageId, pageWidth, pageHeight])
  useLayoutEffect(() => { surface.current!.setPageVisible(backgroundVisible) }, [backgroundVisible])
  useEffect(() => () => { if (loadedDocument) void loadedDocument.reader.close().catch(() => undefined) }, [loadedDocument])
  useEffect(() => () => openAbort.current?.abort(), [])
  useEffect(() => {
    if (!loadedDocument || pageIndex < 0 || !pageId) return
    const controller = new AbortController()
    const view = surface.current!
    const render = async () => {
      try {
        const canvas = pageIndex === 0 ? loadedDocument.first : await loadedDocument.reader.render(pageIndex, 1450, controller.signal)
        if (controller.signal.aborted) return
        view.setPageBackground(canvas)
      } catch {
        if (!controller.signal.aborted) setNotice({ title: '无法显示文档底稿。', message: `第 ${pageIndex + 1} 页渲染失败，编辑内容仍保留。` })
      }
    }
    void render()
    return () => controller.abort()
  }, [loadedDocument, pageId, pageIndex])
  useLayoutEffect(() => {
    const view = surface.current!
    view.render(scene)
    const preview = propertyPreview.current
    if (preview) view.previewProperties(preview.id, preview.changes)
  }, [scene])
  useLayoutEffect(() => {
    const colors = getComputedStyle(document.documentElement)
    surface.current!.setSelectionColors(colors.getPropertyValue('--selection').trim(), colors.getPropertyValue('--sheet').trim())
  }, [scene, theme])
  useLayoutEffect(() => { surface.current!.setTool(tool) }, [tool])
  useLayoutEffect(() => { surface.current!.setHand(hand) }, [hand])
  useLayoutEffect(() => { surface.current!.setSnap(snap) }, [snap])

  function setTool(next: Tool) {
    surface.current?.cancelExtension()
    setHand(false)
    updateTool(next)
  }

  function toggleHand() {
    if (editing) return
    updateTool('select')
    setHand(active => !active)
  }

  function selectFromNavigator(ids: readonly string[], extend: boolean) {
    finishPropertyPreview()
    const view = surface.current
    view?.finishEditing()
    setTool('select')
    view?.setTool('select')
    view?.selectFromNavigator(ids, extend)
  }

  function locateFromNavigator(id: string) {
    selectFromNavigator([id], false)
    surface.current?.fitContent(id)
  }

  function travel(step: typeof undo) {
    finishPropertyPreview()
    surface.current?.finishEditing()
    const current = sessionRef.current
    const history = step(current.history)
    if (history !== current.history) {
      const changed = changedPage(current.history.scene, history.scene)
      if (changed && changed !== activePage.current) selectPage(changed)
      publish({ ...current, history })
    }
  }

  function currentPageScene() {
    return pageScene(sessionRef.current.history.scene, activePage.current)
  }

  function switchPage(id: string | undefined) {
    setPageId(id)
    activePage.current = id
  }

  function selectPage(id: string) {
    if (id === activePage.current || !sessionRef.current.history.scene.document?.pages.some(page => page.id === id)) return
    finishPropertyPreview()
    surface.current?.resetInteraction()
    setHand(false)
    switchPage(id)
  }

  function togglePageBackground(id: string) {
    if (!sessionRef.current.history.scene.document?.pages.some(page => page.id === id)) return
    setHiddenBackgrounds(previous => {
      const next = new Set(previous)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }

  function newProject() {
    if ((isProjectDirty(sessionRef.current) || surface.current?.hasPendingText() || hasPendingProperties()) && !window.confirm(discardMessage)) return
    projectGeneration.current++
    openRequest.current++
    openAbort.current?.abort()
    setReading(false)
    setOpenProgress(undefined)
    setImporting(false)
    propertyPreview.current = undefined
    surface.current?.resetInteraction()
    surface.current?.resetViewport()
    setHand(false)
    publish(createProjectSession(crypto.randomUUID()))
    switchPage(undefined)
    setHiddenBackgrounds(new Set())
    setLoadedDocument(undefined)
    setProjectName(untitled)
    setNotice(undefined)
  }

  function saveProject() {
    finishPropertyPreview()
    surface.current?.finishEditing()
    const current = sessionRef.current
    try {
      downloadLocalProject(projectName, encodeProject(current.history.scene))
      publish(markProjectSaved(current))
      setNotice(undefined)
    } catch {
      setNotice({ title: '无法保存项目。', message: '未能开始下载，当前画布未更改。' })
    }
  }

  async function openLocalProject(file: File) {
    const request = ++openRequest.current
    openAbort.current?.abort()
    const controller = new AbortController()
    openAbort.current = controller
    setReading(true)
    setOpenProgress(undefined)
    let loaded: LoadedDocument | undefined
    let adopted = false
    try {
      let opened: CanvasScene
      if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
        const result = await importPdf(file, controller.signal)
        loaded = { ...result, pdfReader: result.reader }
        opened = result.scene
      } else if (/\.pptx$/i.test(file.name) || file.type === pptxMime) {
        setOpenProgress('正在读取 PPTX…')
        const result = await importPptx(file, controller.signal, (page, total) => {
          if (request === openRequest.current) setOpenProgress(`正在生成底稿：${page} / ${total}`)
        })
        loaded = result
        opened = result.scene
      } else if (/\.(pptm|ppt)$/i.test(file.name)) {
        throw new Error('只支持 .pptx，不支持旧版 .ppt 或含宏的 .pptm。')
      } else {
        let source: string
        try { source = await readLocalProject(file) }
        catch { throw new Error('无法读取所选项目文件。') }
        if (request !== openRequest.current) return
        const decoded = decodeProject(source)
        if (!decoded.ok) { showOpenError(decoded.message); return }
        opened = decoded.scene
        if (opened.document?.source.kind === 'pptx') loaded = await preparePptx(opened.document.source.backgrounds, controller.signal)
        else {
          const pdf = await preparePdf(opened, controller.signal)
          if (pdf) { opened = pdf.scene; loaded = { reader: pdf.reader, first: pdf.first, pdfReader: pdf.reader } }
        }
      }
      if (request !== openRequest.current) return
      for (const asset of allImages(opened)) {
        await prepareImage(asset)
        if (request !== openRequest.current) return
      }
      const current = sessionRef.current
      if (isProjectDirty(current) || surface.current?.hasPendingText() || hasPendingProperties()) {
        if (!window.confirm(discardMessage)) return
      }
      const result = openDecodedProject(current, opened, true)
      if (result.status !== 'opened') return
      const openedAssets = allImages(result.session.history.scene)
      allImages(opened).forEach((asset, i) => sharePreparedImage(asset, openedAssets[i]))
      projectGeneration.current++
      setImporting(false)
      propertyPreview.current = undefined
      surface.current?.resetInteraction()
      surface.current?.resetViewport()
      setHand(false)
      publish(result.session)
      switchPage(result.session.history.scene.document?.pages[0]?.id)
      setHiddenBackgrounds(new Set())
      setLoadedDocument(loaded)
      adopted = true
      setProjectName(file.name.replace(/\.(json|pdf|pptx)$/i, '') || untitled)
      setNotice(undefined)
    } catch (error) {
      if (request === openRequest.current) showOpenError(error instanceof Error ? error.message : '文件无法打开。')
    } finally {
      if (loaded && !adopted) void loaded.reader.close().catch(() => undefined)
      if (request === openRequest.current) { setReading(false); setOpenProgress(undefined) }
    }
  }

  function cancelOpen() {
    openRequest.current++
    openAbort.current?.abort()
    setReading(false)
    setOpenProgress(undefined)
  }

  async function importImage(file: File) {
    const generation = projectGeneration.current
    const startingPage = activePage.current
    setImporting(true)
    try {
      const { asset, width, height } = await readImageAsset(file, crypto.randomUUID())
      const view = surface.current
      if (generation !== projectGeneration.current || startingPage !== activePage.current || !view) return
      let idle = view.whenIdle()
      while (idle) {
        await idle
        if (generation !== projectGeneration.current || startingPage !== activePage.current || view !== surface.current) return
        idle = view.whenIdle()
      }
      const current = currentPageScene().images ?? []
      const existing = current.find(entry => entry.mime === asset.mime && entry.data === asset.data)
      if (!existing && current.reduce((bytes, entry) => bytes + imageAssetBytes(entry), imageAssetBytes(asset)) > maxProjectImageBytes) {
        throw new Error('此项目的图片原始数据合计不能超过 40 MiB。')
      }
      finishPropertyPreview()
      view.finishEditing()
      setTool('select')
      const id = crypto.randomUUID()
      if (!commit([
        ...(existing ? [] : [{ type: 'add-image-asset', asset } as const]),
        { type: 'create', object: { id, type: 'image', assetId: existing?.id ?? asset.id, ...view.imagePlacement(width, height), rotation: 0 } },
      ], [id])) throw new Error('图片无法加入当前项目。')
      setNotice(undefined)
    } catch (error) {
      if (generation === projectGeneration.current) setNotice({ title: '无法插入图片。', message: error instanceof Error ? error.message : '无法读取所选图片。' })
    } finally {
      if (generation === projectGeneration.current) setImporting(false)
    }
  }

  function showOpenError(message: string) {
    setNotice({ title: '无法打开项目。', message: `${message} 当前画布未更改。` })
  }

  const selected = scene.objects.filter(object => selectedIds.includes(object.id))
  const canUndo = past.length > 0, canRedo = future.length > 0

  function exportSelection() {
    if (reading || editing || !selectedIds.length) return
    try {
      const current = currentPageScene(), source = current.objects
      const preview = propertyPreview.current
      const objects = preview ? source.map(object => {
        if (object.id !== preview.id) return object
        const projected = { ...object, ...preview.changes }
        return projected.type === 'text' ? { ...projected, anchorSize: measureTextAnchor(projected) } : projected
      }) : source
      const svg = selectionSvg(objects, selectedIds, current.images)
      if (!svg) return
      downloadLocalFile(`${projectName}-选区.svg`, svg, 'image/svg+xml;charset=utf-8')
      setNotice(undefined)
    } catch {
      setNotice({ title: '无法导出 SVG。', message: '未生成 SVG 文件，请检查选区后重试。' })
    }
  }

  function copy() {
    finishPropertyPreview()
    const current = currentPageScene()
    const objects = captureSelection(current.objects, selectedIds)
    const used = new Set(objects.flatMap(object => object.type === 'image' ? [object.assetId] : []))
    if (objects.length) setClipboard({ objects, images: (current.images ?? []).filter(asset => used.has(asset.id)) })
  }

  function paste() {
    if (!clipboard.objects.length) return
    finishPropertyPreview()
    const current = currentPageScene().images ?? []
    const remap = new Map<string, string>()
    const commands: SceneCommand[] = []
    for (const asset of clipboard.images) {
      const match = current.find(entry => entry.mime === asset.mime && entry.data === asset.data)
      if (match) { remap.set(asset.id, match.id); continue }
      const next = current.some(entry => entry.id === asset.id) ? { ...asset, id: crypto.randomUUID() } : asset
      sharePreparedImage(asset, next)
      remap.set(asset.id, next.id)
      commands.push({ type: 'add-image-asset', asset: next })
    }
    const copies = offsetCopies(clipboard.objects, () => crypto.randomUUID(), { x: 24, y: 24 }).map(object =>
      object.type === 'image' ? { ...object, assetId: remap.get(object.assetId) ?? object.assetId } : object)
    setTool('select')
    if (!commit([...commands, ...copies.map(object => ({ type: 'create' as const, object }))], copies.map(object => object.id))) {
      setNotice({ title: '无法粘贴对象。', message: '图片资源无效或项目图片原始数据合计超过 40 MiB。' })
    }
  }

  function remove() {
    finishPropertyPreview()
    commit(selected.map(({ id }) => ({ type: 'delete', id })), [])
  }

  function updateProperties(id: string, changes: ObjectChanges) {
    finishPropertyPreview()
    commit([{ type: 'update', id, changes }])
  }

  function beginDocumentExport() {
    if (canvasDocument && loadedDocument && pageIndex >= 0 && !reading && !importing && !editing) {
      const preview = propertyPreview.current
      const pages = preview ? canvasDocument.pages.map((page, index) => index !== pageIndex ? page : { ...page,
        scene: { ...page.scene, objects: page.scene.objects.map(object => {
          if (object.id !== preview.id) return object
          const data = { ...object, ...preview.changes }
          return data.type === 'text' ? { ...data, anchorSize: measureTextAnchor(data) } : data
        }) },
      }) : canvasDocument.pages
      if (isPdfDocument(canvasDocument)) {
        if (!loadedDocument.pdfReader) return
        setDocumentExport({ kind: 'pdf', document: { ...canvasDocument, pages }, reader: loadedDocument.pdfReader, current: pageIndex })
      } else if (canvasDocument.source.kind === 'pptx') {
        setDocumentExport({ kind: 'pptx', document: { source: canvasDocument.source, pages }, reader: loadedDocument.reader, current: pageIndex })
      } else return
      exportModalOpen.current = true
    }
  }

  async function downloadDocument(indexes: readonly number[]) {
    if (!documentExport) return
    const { kind, document, reader } = documentExport
    const bytes = kind === 'pdf' ? Uint8Array.from(await exportPdf(document, reader, indexes)) : await exportPptx(document, indexes)
    downloadLocalFile(`${projectName}${indexes.length === 1 ? `-第${indexes[0] + 1}页` : ''}.${kind}`, bytes,
      kind === 'pdf' ? 'application/pdf' : pptxMime)
  }

  function closeDocumentExport() {
    exportModalOpen.current = false
    setDocumentExport(undefined)
  }

  useLayoutEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (documentExport || editing || surface.current?.isComposing()) return
      if (event.key === 'Escape' && !event.defaultPrevented && surface.current?.cancelExtension()) { event.preventDefault(); return }
      if (isTemporaryHandKey(event)) {
        event.preventDefault()
        surface.current?.setHand(true, true)
        return
      }
      const shortcut = editingShortcut(event)
      if (!shortcut) return
      const action = {
        undo: canUndo ? () => travel(undo) : undefined,
        redo: canRedo ? () => travel(redo) : undefined,
        copy: selected.length ? copy : undefined,
        paste: clipboard.objects.length ? paste : undefined,
        delete: selected.length ? remove : undefined,
      }[shortcut]
      if (!action) return
      event.preventDefault()
      action()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  })

  useLayoutEffect(() => {
    const release = () => surface.current?.setHand(false, true)
    const keyup = (event: KeyboardEvent) => { if (event.code === 'Space') release() }
    window.addEventListener('keyup', keyup)
    window.addEventListener('blur', release)
    return () => { window.removeEventListener('keyup', keyup); window.removeEventListener('blur', release) }
  }, [])

  return { scene, document: canvasDocument, pageId, pageIndex, selectPage, hiddenBackgrounds, togglePageBackground, pageReader: loadedDocument?.reader,
    documentExport, beginDocumentExport, downloadDocument, closeDocumentExport,
    tool, setTool, selected, editing, canvas, host, canUndo, canRedo, canPaste: clipboard.objects.length > 0,
    undo: () => travel(undo), redo: () => travel(redo), copy, paste, remove, previewProperties, finishPropertyPreview, updateProperties,
    projectName, notice, reading, openProgress, importing, newProject, saveProject, openLocalProject, cancelOpen, importImage, exportSelection,
    hand, snap, zoom, continuing, toggleHand, toggleSnap: () => setSnap(active => !active),
    zoomTo: (zoom: number) => surface.current?.setZoom(zoom), fitContent: () => surface.current?.fitContent(),
    selectFromNavigator, locateFromNavigator,
    hasPendingProperties, isComposing: () => surface.current?.isComposing() ?? false }
}

function allImages(scene: CanvasScene) {
  return scene.document ? scene.document.pages.flatMap(page => page.scene.images ?? []) : scene.images ?? []
}
