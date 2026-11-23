import type { CommandErrorCode, SceneCommand } from './commands'
import { connectionResolver, hasBinding, indexObjects, isConnector } from './connections'
import { submitPage, type SceneHistory } from './history'
import { hasExactKeys, isDataRecord, isNonBlankString, sameObject } from './scene'
import { explicitConnections, locateScene, type SceneAddress } from './sceneGraph'

declare const grantBrand: unique symbol
export type LocalEditGrant = Readonly<{ [grantBrand]: true }>
const grants = new WeakMap<LocalEditGrant, { history: SceneHistory; address: SceneAddress; writableIds: readonly string[] }>()

type LocalEditError = CommandErrorCode | 'stale-scope' | 'text-layout-required'
type LocalSubmission = { ok: true; history: SceneHistory; writtenIds: readonly string[]; derivedConnectorIds: readonly string[] } |
  { ok: false; history: SceneHistory; code: LocalEditError; index: number }

/** Issued by the trusted local caller for this exact history snapshot, not from request JSON. */
export function createLocalEditGrant(history: SceneHistory, address: SceneAddress, writableIds: readonly string[]): LocalEditGrant | undefined {
  const located = locateScene(history.scene, address)
  if (!located) return
  const objects = indexObjects(located.scene.objects)
  if (!writableIds.every(id => objects.has(id))) return
  const grant = Object.freeze({}) as LocalEditGrant
  grants.set(grant, { history, address: { projectId: address.projectId, pageId: address.pageId }, writableIds: [...new Set(writableIds)] })
  return grant
}

export function submitLocalEdit(history: SceneHistory, grant: LocalEditGrant, request: unknown): LocalSubmission {
  const fail = (code: LocalEditError, index = 0): LocalSubmission => ({ ok: false, history, code, index })
  const permission = grants.get(grant)
  if (!permission) return fail('out-of-scope')
  if (permission.history !== history) return fail('stale-scope')
  let input: unknown
  try { input = structuredClone(request) } catch { return fail('invalid-command') }
  if (!isDataRecord(input) || !hasExactKeys(input, ['projectId', 'pageId', 'commands']) || !isNonBlankString(input.projectId) ||
      (input.pageId !== null && !isNonBlankString(input.pageId)) || !Array.isArray(input.commands)) return fail('invalid-command')
  const { address, writableIds } = permission
  if (address.pageId !== input.pageId || address.projectId !== input.projectId) return fail('out-of-scope')
  const before = locateScene(history.scene, address)?.scene
  if (!before) return fail('unknown-page')
  const commands: SceneCommand[] = []
  for (const [i, command] of input.commands.entries()) {
    if (!isDataRecord(command) || !isNonBlankString(command.type)) return fail('invalid-command', i)
    if (command.type !== 'update' && command.type !== 'delete') return fail('out-of-scope', i)
    if (!isNonBlankString(command.id) || !hasExactKeys(command, command.type === 'update' ? ['type', 'id', 'changes'] : ['type', 'id']) ||
        (command.type === 'update' && !isDataRecord(command.changes))) return fail('invalid-command', i)
    if (command.type === 'update' && Object.hasOwn(command.changes as object, 'anchorSize')) return fail('invalid-command', i)
    commands.push(command as SceneCommand)
  }
  const result = submitPage(history, address.pageId ?? undefined, commands, { sceneId: before.id, writableIds })
  if (!result.ok) return result
  if (result.history === history) return { ...result, writtenIds: [], derivedConnectorIds: [] }

  const after = locateScene(result.history.scene, address)!.scene
  const from = indexObjects(before.objects), to = indexObjects(after.objects)
  // The headless caller cannot remeasure UI font layout. Permit moves and styles, but not a guess at a bound text frame.
  const boundTargets = new Set([...explicitConnections(before.objects), ...explicitConnections(after.objects)].map(relation => relation.targetId))
  for (const [index, command] of commands.entries()) {
    if (command.type !== 'update' || !boundTargets.has(command.id)) continue
    const previous = from.get(command.id), next = to.get(command.id)
    if (previous?.type === 'text' && next?.type === 'text' && (['text', 'fontFamily', 'fontSize'] as const).some(key =>
      previous[key] !== next[key] && Object.hasOwn(command.changes, key))) return fail('text-layout-required', index)
  }
  const beforeDisplay = connectionResolver(from), afterDisplay = connectionResolver(to)
  const writtenIds: string[] = [], derivedConnectorIds: string[] = []
  for (const object of before.objects) {
    const next = to.get(object.id)
    if (!sameObject(object, next)) writtenIds.push(object.id)
    else if (hasBinding(object) && next && isConnector(next) && !sameObject(beforeDisplay.display(object), afterDisplay.display(next))) {
      derivedConnectorIds.push(object.id)
    }
  }
  return { ...result, writtenIds, derivedConnectorIds }
}
