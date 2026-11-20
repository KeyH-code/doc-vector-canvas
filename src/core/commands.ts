import { isCanvasObject, isDataRecord, sameScene, type CanvasObject, type CanvasScene, type RectangleObject, type TextObject } from './scene'

type Changes = Partial<Omit<RectangleObject, 'id' | 'type'> & Omit<TextObject, 'id' | 'type'>>

export type SceneCommand = Readonly<{ type: 'create'; object: CanvasObject }> |
  Readonly<{ type: 'update'; id: string; changes: Changes }>

export type CommandScope = Readonly<{ sceneId: string; writableIds: readonly string[]; allowCreate?: boolean }>

export type CommandErrorCode = 'duplicate-object' | 'unknown-object' | 'invalid-object' | 'out-of-scope' | 'invalid-command'
export type CommandResult = { ok: true; scene: CanvasScene } |
  { ok: false; code: CommandErrorCode; index: number }

/** Only trusted callers with access to the whole scene may omit scope. */
export function applyCommands(scene: CanvasScene, commands: readonly SceneCommand[], scope?: CommandScope): CommandResult {
  const objects = [...scene.objects]

  for (const [index, command] of commands.entries()) {
    if (!isDataRecord(command) || (command.type !== 'create' && command.type !== 'update')) {
      return { ok: false, code: 'invalid-command', index }
    }
    if (scope && (scope.sceneId !== scene.id ||
      (command.type === 'create' ? scope.allowCreate !== true : !scope.writableIds.includes(command.id)))) {
      return { ok: false, code: 'out-of-scope', index }
    }

    if (command.type === 'create') {
      if (!isCanvasObject(command.object)) return { ok: false, code: 'invalid-object', index }
      if (objects.some((object) => object.id === command.object.id)) return { ok: false, code: 'duplicate-object', index }
      objects.push({ ...command.object })
      continue
    }

    const target = objects.findIndex((object) => object.id === command.id)
    if (target < 0) return { ok: false, code: 'unknown-object', index }
    if (!isDataRecord(command.changes) || Object.hasOwn(command.changes, 'id') || Object.hasOwn(command.changes, 'type')) {
      return { ok: false, code: 'invalid-object', index }
    }
    const next = { ...objects[target], ...command.changes }
    if (!isCanvasObject(next)) return { ok: false, code: 'invalid-object', index }
    objects[target] = next
  }

  const next: CanvasScene = { id: scene.id, objects }
  return { ok: true, scene: sameScene(scene, next) ? scene : next }
}
