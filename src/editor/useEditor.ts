import { useLayoutEffect, useRef, useState } from 'react'
import type { ObjectChanges, SceneCommand } from '../core/commands'
import { redo, submit, undo } from '../core/history'
import type { CanvasObject } from '../core/scene'
import { downloadLocalProject, readLocalProject } from '../project/localFiles'
import { encodeProject } from '../project/projectFile'
import { createProjectSession, isProjectDirty, markProjectSaved, openProject, type ProjectSession } from '../project/projectSession'
import { editingShortcut } from '../ui/shortcuts'
import { FabricSurface, paperHeight, paperWidth, type Tool } from './FabricSurface'

const untitled = '未命名项目'
const discardMessage = '当前项目有未保存的改动。是否放弃改动并继续？'
type PropertyPreview = { id: string; changes: ObjectChanges }

export function useEditor(theme: 'light' | 'dark') {
  const [session, setSession] = useState(() => createProjectSession(crypto.randomUUID()))
  const sessionRef = useRef(session)
  const [tool, setTool] = useState<Tool>('select')
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
      tool: setTool,
      editing: setEditing,
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

  function copy() {
    finishPropertyPreview()
    const objects = sessionRef.current.history.scene.objects.filter(object => selectedIds.includes(object.id))
    if (objects.length) setClipboard(structuredClone(objects))
  }

  function paste() {
    if (!clipboard.length) return
    finishPropertyPreview()
    const dx = pasteOffset(clipboard, 'x', paperWidth)
    const dy = pasteOffset(clipboard, 'y', paperHeight)
    const copies = clipboard.map(object => ({ ...object, id: crypto.randomUUID(), x: object.x + dx, y: object.y + dy }))
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

  return { scene, tool, setTool, selected, editing, canvas, host, canUndo, canRedo, canPaste: clipboard.length > 0,
    undo: () => travel(undo), redo: () => travel(redo), copy, paste, remove, previewProperties, finishPropertyPreview, updateProperties,
    projectName, notice, reading, newProject, saveProject, openLocalProject,
    isComposing: () => surface.current?.isComposing() ?? false }
}

function pasteOffset(objects: readonly CanvasObject[], axis: 'x' | 'y', size: number) {
  let min = Infinity, max = -Infinity
  for (const object of objects) {
    min = Math.min(min, object[axis]); max = Math.max(max, object[axis])
  }
  return max + 24 <= size ? 24 : min >= 24 ? -24 : 0
}
