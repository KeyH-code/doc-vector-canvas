import { createHistory, type SceneHistory } from '../core/history'
import { createScene, sameScene, type CanvasScene } from '../core/scene'
import { decodeProject, type ProjectFileResult } from './projectFile'

export type ProjectSession = Readonly<{ history: SceneHistory; savedScene: CanvasScene }>

function startSession(scene: CanvasScene): ProjectSession {
  const history = createHistory(scene)
  return { history, savedScene: history.scene }
}

export function createProjectSession(id: string): ProjectSession {
  return startSession(createScene(id))
}

export function isProjectDirty(session: ProjectSession): boolean {
  return !sameScene(session.history.scene, session.savedScene)
}

/** Call after the browser has started downloading the current project. */
export function markProjectSaved(session: ProjectSession): ProjectSession {
  return { ...session, savedScene: session.history.scene }
}

type OpenRequest = { status: 'cancelled' } | { status: 'read-error' } |
  { status: 'read'; source: string; discardChanges?: boolean }

type OpenResult = { status: 'opened' | 'cancelled' | 'needs-confirmation'; session: ProjectSession } |
  { status: 'error'; code: Extract<ProjectFileResult, { ok: false }>['code'] | 'read-error'; message: string; session: ProjectSession }

export function openProject(session: ProjectSession, request: OpenRequest): OpenResult {
  if (request.status === 'cancelled') return { status: 'cancelled', session }
  if (request.status === 'read-error') return { status: 'error', code: 'read-error', message: '无法读取所选项目文件。', session }

  const decoded = decodeProject(request.source)
  if (!decoded.ok) return { status: 'error', code: decoded.code, message: decoded.message, session }
  return openDecodedProject(session, decoded.scene, request.discardChanges)
}

export function openDecodedProject(session: ProjectSession, scene: CanvasScene, discardChanges = false): OpenResult {
  if (!discardChanges && isProjectDirty(session)) return { status: 'needs-confirmation', session }
  return { status: 'opened', session: startSession(scene) }
}
