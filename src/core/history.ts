import { applyCommands, type CommandErrorCode, type CommandScope, type SceneCommand } from './commands'
import type { CanvasScene } from './scene'

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
  if (result.scene === history.scene) return { ok: true, history }
  return { ok: true, history: { scene: result.scene, past: [...history.past, history.scene], future: [] } }
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
