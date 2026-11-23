import { applyCommands, type CommandErrorCode, type CommandScope, type SceneCommand } from './commands'
import type { CanvasScene } from './scene'
import { documentImagesWithinLimit } from './document'

export type SceneHistory = Readonly<{
  scene: CanvasScene
  past: readonly CanvasScene[]
  future: readonly CanvasScene[]
}>

export type Submission = { ok: true; history: SceneHistory } |
  { ok: false; code: CommandErrorCode; index: number; history: SceneHistory }

export function createHistory(scene: CanvasScene): SceneHistory {
  return { scene: structuredClone(scene), past: [], future: [] }
}

export function submit(history: SceneHistory, commands: readonly SceneCommand[], scope?: CommandScope): Submission {
  const result = applyCommands(history.scene, commands, scope)
  if (!result.ok) return { ...result, history }
  return record(history, result.scene)
}

export function submitPage(history: SceneHistory, pageId: string | undefined, commands: readonly SceneCommand[], scope?: CommandScope): Submission {
  const document = history.scene.document
  if (!document) return pageId === undefined ? submit(history, commands, scope) : { ok: false, code: 'unknown-page', index: 0, history }
  const page = document.pages.find(page => page.id === pageId)
  if (!page) return { ok: false, code: 'unknown-page', index: 0, history }
  const result = applyCommands(page.scene, commands, scope)
  if (!result.ok) return { ...result, history }
  if (result.scene === page.scene) return { ok: true, history }
  const pages = document.pages.map(entry => entry === page ? { ...entry, scene: result.scene } : entry)
  if (!documentImagesWithinLimit(pages)) return { ok: false, code: 'invalid-image', index: 0, history }
  return record(history, { ...history.scene, document: { ...document, pages } })
}

function record(history: SceneHistory, next: CanvasScene): Submission {
  if (next === history.scene) return { ok: true, history }
  return { ok: true, history: { scene: next, past: [...history.past, history.scene], future: [] } }
}

export function undo(history: SceneHistory): SceneHistory {
  const previous = history.past.at(-1)
  if (!previous) return history
  return { scene: previous, past: history.past.slice(0, -1), future: [...history.future, history.scene] }
}

export function redo(history: SceneHistory): SceneHistory {
  const next = history.future.at(-1)
  if (!next) return history
  return { scene: next, past: [...history.past, history.scene], future: history.future.slice(0, -1) }
}
