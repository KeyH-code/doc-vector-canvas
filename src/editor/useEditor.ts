import { useLayoutEffect, useRef, useState } from 'react'
import type { ObjectChanges, SceneCommand } from '../core/commands'
import { captureSelection, isConnector, offsetCopies } from '../core/connections'
import { redo, submit, undo } from '../core/history'
import { imageAssetBytes, maxProjectImageBytes, type ImageAsset } from '../core/imageAssets'
import type { CanvasObject } from '../core/scene'
import { selectionSvg } from '../export/selectionSvg'
import { downloadLocalFile, downloadLocalProject, readLocalProject } from '../project/localFiles'
import { prepareImage, readImageAsset, sharePreparedImage } from '../project/imageImport'
import { decodeProject, encodeProject } from '../project/projectFile'
import { createProjectSession, isProjectDirty, markProjectSaved, openDecodedProject, type ProjectSession } from '../project/projectSession'
import { editingShortcut, isTemporaryHandKey } from '../ui/shortcuts'
import { FabricSurface, type Continuation, type Tool } from './FabricSurface'
import { measureTextAnchor } from './fabricObjects'

const untitled = '未命名项目'
const discardMessage = '当前项目有未保存的改动。是否放弃改动并继续？'
type PropertyPreview = { id: string; changes: ObjectChanges }
type Clipboard = { objects: readonly CanvasObject[]; images: readonly ImageAsset[] }

export function useEditor(theme: 'light' | 'dark') {
  const [session, setSession] = useState(() => createProjectSession(crypto.randomUUID()))
  const sessionRef = useRef(session)
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
  const [importing, setImporting] = useState(false)
  const projectGeneration = useRef(0)
  const openRequest = useRef(0)
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
    const objects = current.history.scene.objects
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
    const result = submit(current.history, [...anchorMeasurements, ...normalized])
    if (!result.ok || result.history === current.history) return result.ok
    if (result.history.scene.images) for (const command of commands) {
      if (command.type !== 'add-image-asset') continue
      const image = result.history.scene.images.find(asset => asset.id === command.asset.id)
      if (image) sharePreparedImage(command.asset, image)
    }
    if (select) surface.current?.selectOnRender(select)
    publish({ ...current, history: result.history })
    return true
  }

  function finishPropertyPreview(id?: string) {
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
    const object = sessionRef.current.history.scene.objects.find(({ id }) => id === preview.id)
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

  const { scene, past, future } = session.history
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
    if (history !== current.history) publish({ ...current, history })
  }

  function newProject() {
    if ((isProjectDirty(sessionRef.current) || surface.current?.hasPendingText() || hasPendingProperties()) && !window.confirm(discardMessage)) return
    projectGeneration.current++
    openRequest.current++
    setReading(false)
    setImporting(false)
    propertyPreview.current = undefined
    surface.current?.resetInteraction()
    surface.current?.resetViewport()
    setHand(false)
    publish(createProjectSession(crypto.randomUUID()))
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
    setReading(true)
    try {
      let source: string
      try {
        source = await readLocalProject(file)
      } catch {
        if (request === openRequest.current) showOpenError('无法读取所选项目文件。')
        return
      }
      if (request !== openRequest.current) return
      const decoded = decodeProject(source)
      if (!decoded.ok) { showOpenError(decoded.message); return }
      try {
        for (const asset of decoded.scene.images ?? []) {
          await prepareImage(asset)
          if (request !== openRequest.current) return
        }
      } catch (error) {
        if (request === openRequest.current) showOpenError(error instanceof Error ? error.message : '无法解码项目中的图片。')
        return
      }
      const current = sessionRef.current
      if (isProjectDirty(current) || surface.current?.hasPendingText() || hasPendingProperties()) {
        if (!window.confirm(discardMessage)) return
      }
      const result = openDecodedProject(current, decoded.scene, true)
      if (result.status !== 'opened') return
      const openedAssets = result.session.history.scene.images ?? []
      decoded.scene.images?.forEach((asset, i) => sharePreparedImage(asset, openedAssets[i]))
      projectGeneration.current++
      setImporting(false)
      propertyPreview.current = undefined
      surface.current?.resetInteraction()
      surface.current?.resetViewport()
      setHand(false)
      publish(result.session)
      setProjectName(file.name.replace(/\.json$/i, '') || untitled)
      setNotice(undefined)
    } finally {
      if (request === openRequest.current) setReading(false)
    }
  }

  async function importImage(file: File) {
    const generation = projectGeneration.current
    setImporting(true)
    try {
      const { asset, width, height } = await readImageAsset(file, crypto.randomUUID())
      const view = surface.current
      if (generation !== projectGeneration.current || !view) return
      let idle = view.whenIdle()
      while (idle) {
        await idle
        if (generation !== projectGeneration.current || view !== surface.current) return
        idle = view.whenIdle()
      }
      const current = sessionRef.current.history.scene.images ?? []
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
      const source = sessionRef.current.history.scene.objects
      const preview = propertyPreview.current
      const objects = preview ? source.map(object => {
        if (object.id !== preview.id) return object
        const projected = { ...object, ...preview.changes }
        return projected.type === 'text' ? { ...projected, anchorSize: measureTextAnchor(projected) } : projected
      }) : source
      const svg = selectionSvg(objects, selectedIds, sessionRef.current.history.scene.images)
      if (!svg) return
      downloadLocalFile(`${projectName}-选区.svg`, svg, 'image/svg+xml;charset=utf-8')
      setNotice(undefined)
    } catch {
      setNotice({ title: '无法导出 SVG。', message: '未生成 SVG 文件，请检查选区后重试。' })
    }
  }

  function copy() {
    finishPropertyPreview()
    const current = sessionRef.current.history.scene
    const objects = captureSelection(current.objects, selectedIds)
    const used = new Set(objects.flatMap(object => object.type === 'image' ? [object.assetId] : []))
    if (objects.length) setClipboard({ objects, images: (current.images ?? []).filter(asset => used.has(asset.id)) })
  }

  function paste() {
    if (!clipboard.objects.length) return
    finishPropertyPreview()
    const current = sessionRef.current.history.scene.images ?? []
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

  useLayoutEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (editing || surface.current?.isComposing()) return
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

  return { scene, tool, setTool, selected, editing, canvas, host, canUndo, canRedo, canPaste: clipboard.objects.length > 0,
    undo: () => travel(undo), redo: () => travel(redo), copy, paste, remove, previewProperties, finishPropertyPreview, updateProperties,
    projectName, notice, reading, importing, newProject, saveProject, openLocalProject, importImage, exportSelection,
    hand, snap, zoom, continuing, toggleHand, toggleSnap: () => setSnap(active => !active),
    zoomTo: (zoom: number) => surface.current?.setZoom(zoom), fitContent: () => surface.current?.fitContent(),
    selectFromNavigator, locateFromNavigator,
    hasPendingProperties, isComposing: () => surface.current?.isComposing() ?? false }
}
