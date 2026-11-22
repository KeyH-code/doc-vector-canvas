import { useLayoutEffect, useRef, useState } from 'react'
import type { ObjectChanges, SceneCommand } from '../core/commands'
import { redo, submit, undo } from '../core/history'
import type { CanvasObject } from '../core/scene'
import { selectionSvg } from '../export/selectionSvg'
import { downloadLocalFile, downloadLocalProject, readLocalProject } from '../project/localFiles'
import { encodeProject } from '../project/projectFile'
import { createProjectSession, isProjectDirty, markProjectSaved, openProject, type ProjectSession } from '../project/projectSession'
import { editingShortcut, isTemporaryHandKey } from '../ui/shortcuts'
import { FabricSurface, type Tool } from './FabricSurface'

const untitled = '未命名项目'
const discardMessage = '当前项目有未保存的改动。是否放弃改动并继续？'
type PropertyPreview = { id: string; changes: ObjectChanges }

export function useEditor(theme: 'light' | 'dark') {
  const [session, setSession] = useState(() => createProjectSession(crypto.randomUUID()))
  const sessionRef = useRef(session)
  const [tool, updateTool] = useState<Tool>('select')
  const [hand, setHand] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [clipboard, setClipboard] = useState<readonly CanvasObject[]>([])
  const [editing, setEditing] = useState(false)
  const [projectName, setProjectName] = useState(untitled)
  const [notice, setNotice] = useState<{ title: string; message: string }>()
  const [reading, setReading] = useState(false)
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
    const result = submit(current.history, commands)
    if (!result.ok || result.history === current.history) return
    if (select) surface.current?.selectOnRender(select)
    publish({ ...current, history: result.history })
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

  function setTool(next: Tool) {
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
    setReading(true)
    try {
      let source: string
      try {
        source = await readLocalProject(file)
      } catch {
        const result = openProject(sessionRef.current, { status: 'read-error' })
        if (result.status === 'error') showOpenError(result.message)
        return
      }
      const current = sessionRef.current
      let result = openProject(current, { status: 'read', source })
      if (result.status === 'error') {
        showOpenError(result.message)
        return
      }
      if (result.status === 'needs-confirmation' || surface.current?.hasPendingText() || hasPendingProperties()) {
        if (!window.confirm(discardMessage)) return
        if (result.status === 'needs-confirmation') result = openProject(current, { status: 'read', source, discardChanges: true })
      }
      if (result.status !== 'opened') return
      propertyPreview.current = undefined
      surface.current?.resetInteraction()
      surface.current?.resetViewport()
      setHand(false)
      publish(result.session)
      setProjectName(file.name.replace(/\.json$/i, '') || untitled)
      setNotice(undefined)
    } finally {
      setReading(false)
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
      const objects = preview ? source.map(object => object.id === preview.id ? { ...object, ...preview.changes } : object) : source
      const svg = selectionSvg(objects, selectedIds)
      if (!svg) return
      downloadLocalFile(`${projectName}-选区.svg`, svg, 'image/svg+xml;charset=utf-8')
      setNotice(undefined)
    } catch {
      setNotice({ title: '无法导出 SVG。', message: '未生成 SVG 文件，请检查选区后重试。' })
    }
  }

  function copy() {
    finishPropertyPreview()
    const objects = sessionRef.current.history.scene.objects.filter(object => selectedIds.includes(object.id))
    if (objects.length) setClipboard(structuredClone(objects))
  }

  function paste() {
    if (!clipboard.length) return
    finishPropertyPreview()
    const copies = clipboard.map(object => ({ ...object, id: crypto.randomUUID(), x: object.x + 24, y: object.y + 24 }))
    setTool('select')
    commit(copies.map(object => ({ type: 'create', object })), copies.map(object => object.id))
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
        paste: clipboard.length ? paste : undefined,
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

  return { scene, tool, setTool, selected, editing, canvas, host, canUndo, canRedo, canPaste: clipboard.length > 0,
    undo: () => travel(undo), redo: () => travel(redo), copy, paste, remove, previewProperties, finishPropertyPreview, updateProperties,
    projectName, notice, reading, newProject, saveProject, openLocalProject, exportSelection,
    hand, zoom, toggleHand, zoomTo: (zoom: number) => surface.current?.setZoom(zoom), fitContent: () => surface.current?.fitContent(),
    selectFromNavigator, locateFromNavigator,
    hasPendingProperties, isComposing: () => surface.current?.isComposing() ?? false }
}
