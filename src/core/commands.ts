import { isCanvasObject, isDataRecord, sameScene, type CanvasObject, type CanvasScene, type LineObject, type RectangleObject, type StrokeObject, type TextObject } from './scene'
import { bindingKey, detachEndpoints, ends, hasBinding, indexObjects, invalidConnector, isConnector, validConnector, type Endpoint } from './connections'
import { imageAssetsForObjects, isImageAsset, type ImageAsset } from './imageAssets'

type Fields<T> = Omit<T, 'id' | 'type'>
type EditableFields = Fields<RectangleObject> & Fields<TextObject> & Fields<LineObject> & Fields<StrokeObject>
export type ObjectChanges = { -readonly [Key in keyof EditableFields]?: EditableFields[Key] }

export type SceneCommand = Readonly<{ type: 'create'; object: CanvasObject }> |
  Readonly<{ type: 'update'; id: string; changes: ObjectChanges }> |
  Readonly<{ type: 'delete'; id: string }> |
  Readonly<{ type: 'duplicate'; id: string; newId: string; x?: number; y?: number }> |
  Readonly<{ type: 'add-image-asset'; asset: ImageAsset }>

export type CommandScope = Readonly<{ sceneId: string; writableIds: readonly string[]; allowCreate?: boolean }>

export type CommandErrorCode = 'duplicate-object' | 'unknown-object' | 'invalid-object' | 'invalid-connection' | 'invalid-image' | 'out-of-scope' | 'invalid-command'
export type CommandResult = { ok: true; scene: CanvasScene } |
  { ok: false; code: CommandErrorCode; index: number }

function snapshot(object: CanvasObject): CanvasObject {
  return structuredClone(object)
}

function pathCount(object: CanvasObject) {
  if (object.type === 'stroke') return object.points.length - 1
  return isConnector(object) ? object.path?.segments.length ?? 1 : 0
}

/** Only trusted callers with access to the whole scene may omit scope. */
export function applyCommands(scene: CanvasScene, commands: readonly SceneCommand[], scope?: CommandScope): CommandResult {
  const objects = [...scene.objects]
  const assets = new Map((scene.images ?? []).map(asset => [asset.id, asset]))
  let imageEdit = 0
  const touched = new Map<string, number>()
  const lookup = indexObjects(objects)
  // Forward references let a paste preserve paint order even when a line is below its hosts.
  // Still validate each explicit binding so a later deletion cannot hide an invalid command.
  const lookupAt = (index: number) => ({ get(id: string) {
    const current = lookup.get(id)
    if (current) return current
    for (let i = index + 1; i < commands.length; i++) {
      const future = commands[i]
      if (isDataRecord(future) && future.type === 'create' && isCanvasObject(future.object) && future.object.id === id) return future.object
    }
  } })
  const validAt = (line: LineObject, index: number) => validConnector(line, lookupAt(index).get)
  const remember = (object: CanvasObject, index: number) => { lookup.set(object.id, object); touched.set(object.id, index) }

  for (const [index, command] of commands.entries()) {
    if (!isDataRecord(command) || (command.type !== 'create' && command.type !== 'update' && command.type !== 'delete' && command.type !== 'duplicate' && command.type !== 'add-image-asset')) {
      return { ok: false, code: 'invalid-command', index }
    }
    if (scope && (scope.sceneId !== scene.id ||
      ((command.type === 'create' || command.type === 'duplicate' || command.type === 'add-image-asset') && scope.allowCreate !== true) ||
      (command.type !== 'create' && command.type !== 'add-image-asset' && !scope.writableIds.includes(command.id)))) {
      return { ok: false, code: 'out-of-scope', index }
    }

    if (command.type === 'add-image-asset') {
      const asset = command.asset
      if (!isImageAsset(asset) || assets.has(asset.id)) return { ok: false, code: 'invalid-image', index }
      assets.set(asset.id, Object.freeze({ ...asset }))
      imageEdit = index
      continue
    }

    if (command.type === 'create') {
      if (!isCanvasObject(command.object)) return { ok: false, code: 'invalid-object', index }
      if (lookup.has(command.object.id)) return { ok: false, code: 'duplicate-object', index }
      if (command.object.type === 'image' && !assets.has(command.object.assetId)) return { ok: false, code: 'invalid-image', index }
      if (hasBinding(command.object) && !validAt(command.object, index)) return { ok: false, code: 'invalid-connection', index }
      const object = snapshot(command.object)
      if (object.type === 'image') imageEdit = index
      objects.push(object)
      remember(object, index)
      continue
    }

    const target = objects.findIndex((object) => object.id === command.id)
    if (target < 0) return { ok: false, code: 'unknown-object', index }
    const previous = objects[target]
    if (command.type === 'delete') {
      const dependsOnTarget = (object: CanvasObject): object is LineObject => hasBinding(object) &&
        ends.some(end => object[bindingKey[end]]?.targetId === previous.id)
      for (const [position, object] of objects.entries()) {
        if (!dependsOnTarget(object)) continue
        if (scope && !scope.writableIds.includes(object.id)) return { ok: false, code: 'out-of-scope', index }
        if (!validAt(object, index)) return { ok: false, code: 'invalid-connection', index }
        const detached = detachEndpoints(object, lookupAt(index), binding => binding.targetId === previous.id)
        if (!isCanvasObject(detached)) return { ok: false, code: 'invalid-connection', index }
        objects[position] = detached
        remember(detached, index)
      }
      objects.splice(target, 1)
      lookup.delete(previous.id)
      continue
    }
    if (command.type === 'duplicate') {
      if (hasBinding(previous) && !validAt(previous, index)) return { ok: false, code: 'invalid-connection', index }
      const copy = hasBinding(previous) ? detachEndpoints(previous, lookupAt(index), () => true) : previous
      const next = { ...copy, id: command.newId,
        x: command.x === undefined ? copy.x : command.x, y: command.y === undefined ? copy.y : command.y }
      if (!isCanvasObject(next)) return { ok: false, code: 'invalid-object', index }
      if (lookup.has(next.id)) return { ok: false, code: 'duplicate-object', index }
      const object = snapshot(next)
      objects.push(object)
      remember(object, index)
      continue
    }
    if (!isDataRecord(command.changes) || Object.hasOwn(command.changes, 'id') || Object.hasOwn(command.changes, 'type')) {
      return { ok: false, code: 'invalid-object', index }
    }
    const cleared = (end: Endpoint) => {
      const key = bindingKey[end]
      return Object.hasOwn(command.changes, key) && command.changes[key] === undefined
    }
    const detaching = hasBinding(previous) && ends.some(end => previous[bindingKey[end]] && cleared(end))
    if (detaching && !validAt(previous, index)) return { ok: false, code: 'invalid-connection', index }
    const base = detaching ? detachEndpoints(previous, lookupAt(index), (_, end) => cleared(end)) : previous
    const next = { ...base, ...command.changes }
    if (next.type === 'text' && !Object.hasOwn(command.changes, 'anchorSize') &&
        (['text', 'fontFamily', 'fontSize'] as const).some(key => command.changes[key] !== undefined && command.changes[key] !== previous[key as keyof CanvasObject])) delete next.anchorSize
    if (isConnector(previous)) for (const end of ends) {
      const key = bindingKey[end]
      if (cleared(end)) delete next[key as keyof typeof next]
    }
    if (!isCanvasObject(next)) return { ok: false, code: 'invalid-object', index }
    if (next.type === 'image' && !assets.has(next.assetId)) return { ok: false, code: 'invalid-image', index }
    if (hasBinding(next) && !validAt(next, index)) return { ok: false, code: 'invalid-connection', index }
    const object = snapshot(next)
    objects[target] = object
    remember(object, index)
    const count = pathCount(object)
    if (count < pathCount(previous) && objects.some(candidate => hasBinding(candidate) && ends.some(end => {
      const binding = candidate[bindingKey[end]]
      return binding?.targetId === object.id && binding.kind === 'path' && binding.segment >= count
    }))) return { ok: false, code: 'invalid-connection', index }
  }

  const invalid = invalidConnector(objects)
  if (invalid) return { ok: false, code: 'invalid-connection', index: Math.max(touched.get(invalid.id) ?? -1,
    ...ends.map(end => touched.get(invalid[bindingKey[end]]?.targetId ?? '') ?? -1), 0) }
  const images = imageAssetsForObjects(objects, [...assets.values()])
  if (!images) return { ok: false, code: 'invalid-image', index: imageEdit }
  const next: CanvasScene = { id: scene.id, objects, ...(images.length ? { images } : {}) }
  return { ok: true, scene: sameScene(scene, next) ? scene : next }
}
