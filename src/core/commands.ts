import { isCanvasObject, isDataRecord, sameScene, type CanvasObject, type CanvasScene, type LineObject, type RectangleObject, type StrokeObject, type TextObject } from './scene'

type Fields<T> = Omit<T, 'id' | 'type'>
type EditableFields = Fields<RectangleObject> & Fields<TextObject> & Fields<LineObject> & Fields<StrokeObject>
export type ObjectChanges = { -readonly [Key in keyof EditableFields]?: EditableFields[Key] }

export type SceneCommand = Readonly<{ type: 'create'; object: CanvasObject }> |
  Readonly<{ type: 'update'; id: string; changes: ObjectChanges }> |
  Readonly<{ type: 'delete'; id: string }> |
  Readonly<{ type: 'duplicate'; id: string; newId: string; x?: number; y?: number }>

export type CommandScope = Readonly<{ sceneId: string; writableIds: readonly string[]; allowCreate?: boolean }>

export type CommandErrorCode = 'duplicate-object' | 'unknown-object' | 'invalid-object' | 'out-of-scope' | 'invalid-command'
export type CommandResult = { ok: true; scene: CanvasScene } |
  { ok: false; code: CommandErrorCode; index: number }

function snapshot(object: CanvasObject): CanvasObject {
  return object.type === 'stroke' ? { ...object, points: object.points.map(point => ({ ...point })) } : { ...object }
}

/** Only trusted callers with access to the whole scene may omit scope. */
export function applyCommands(scene: CanvasScene, commands: readonly SceneCommand[], scope?: CommandScope): CommandResult {
  const objects = [...scene.objects]

  for (const [index, command] of commands.entries()) {
    if (!isDataRecord(command) || (command.type !== 'create' && command.type !== 'update' && command.type !== 'delete' && command.type !== 'duplicate')) {
      return { ok: false, code: 'invalid-command', index }
    }
    if (scope && (scope.sceneId !== scene.id ||
      ((command.type === 'create' || command.type === 'duplicate') && scope.allowCreate !== true) ||
      (command.type !== 'create' && !scope.writableIds.includes(command.id)))) {
      return { ok: false, code: 'out-of-scope', index }
    }

    if (command.type === 'create') {
      if (!isCanvasObject(command.object)) return { ok: false, code: 'invalid-object', index }
      if (objects.some((object) => object.id === command.object.id)) return { ok: false, code: 'duplicate-object', index }
      objects.push(snapshot(command.object))
      continue
    }

    const target = objects.findIndex((object) => object.id === command.id)
    if (target < 0) return { ok: false, code: 'unknown-object', index }
    const previous = objects[target]
    if (command.type === 'delete') {
      objects.splice(target, 1)
      continue
    }
    if (command.type === 'duplicate') {
      const next = { ...previous, id: command.newId,
        x: command.x === undefined ? previous.x : command.x, y: command.y === undefined ? previous.y : command.y }
      if (!isCanvasObject(next)) return { ok: false, code: 'invalid-object', index }
      if (objects.some(object => object.id === next.id)) return { ok: false, code: 'duplicate-object', index }
      objects.push(snapshot(next))
      continue
    }
    if (!isDataRecord(command.changes) || Object.hasOwn(command.changes, 'id') || Object.hasOwn(command.changes, 'type')) {
      return { ok: false, code: 'invalid-object', index }
    }
    const next = { ...previous, ...command.changes }
    if (!isCanvasObject(next)) return { ok: false, code: 'invalid-object', index }
    objects[target] = previous.type === 'stroke' && next.type === 'stroke' && next.points !== previous.points ? snapshot(next) : next
  }

  const next: CanvasScene = { id: scene.id, objects }
  return { ok: true, scene: sameScene(scene, next) ? scene : next }
}
