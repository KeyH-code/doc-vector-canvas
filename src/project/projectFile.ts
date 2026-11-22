import { hasExactKeys, isCanvasObject, isDataRecord, isNonBlankString, type CanvasObject, type CanvasScene } from '../core/scene'
import { invalidConnector, isConnector } from '../core/connections'

const format = 'document-vector-canvas'
const version = 2

// Keep the legacy field allowlist here when the live scene gains v2-only features.
const v1Common = ['id', 'type', 'x', 'y', 'rotation']
const v1Box = ['width', 'height', 'fill', 'stroke', 'strokeWidth']
const v1Segment = ['dx', 'dy', 'stroke', 'strokeWidth']
const v1Fields = {
  rectangle: v1Box, ellipse: v1Box, line: v1Segment, arrow: v1Segment,
  stroke: ['points', 'stroke', 'strokeWidth'], text: ['text', 'fontFamily', 'fontSize', 'color'],
}

function isV1Object(object: unknown): object is CanvasObject {
  if (!isDataRecord(object) || typeof object.type !== 'string' || !Object.hasOwn(v1Fields, object.type)) return false
  const fields = [...v1Common, ...v1Fields[object.type as keyof typeof v1Fields]]
  if (object.type !== 'text' && Object.hasOwn(object, 'strokeStyle')) fields.push('strokeStyle')
  return hasExactKeys(object, fields) && isCanvasObject(object) && (!isConnector(object) || object.dx !== 0 || object.dy !== 0)
}

const messages = {
  'invalid-json': '项目文件不是有效的 JSON。',
  'unsupported-format': '这不是文档矢量画布的项目文件。',
  'unsupported-version': '当前应用不支持这个项目版本。',
  'invalid-scene': '项目中的画布数据无效。',
  'invalid-object': '项目中有未知类型或属性无效的图元。',
  'invalid-connection': '项目中有无法定位到有效图形边界的连接。',
  'duplicate-object': '项目中有重复的图元 ID。',
} as const

type ProjectFileError = { ok: false; code: keyof typeof messages; message: string }
export type ProjectFileResult = { ok: true; scene: CanvasScene } | ProjectFileError

function fail(code: ProjectFileError['code']): ProjectFileError {
  return { ok: false, code, message: messages[code] }
}

export function encodeProject(scene: CanvasScene): string {
  return JSON.stringify({ format, version, scene: { id: scene.id, objects: scene.objects } }, null, 2)
}

export function decodeProject(source: string): ProjectFileResult {
  let data: unknown
  try {
    data = JSON.parse(source)
  } catch {
    return fail('invalid-json')
  }

  if (!isDataRecord(data) || data.format !== format) return fail('unsupported-format')
  if (data.version !== 1 && data.version !== version) return fail('unsupported-version')
  if (!hasExactKeys(data, ['format', 'version', 'scene'])) return fail('invalid-scene')
  const scene = data.scene
  if (!isDataRecord(scene) || !hasExactKeys(scene, ['id', 'objects']) ||
      !isNonBlankString(scene.id) || !Array.isArray(scene.objects)) return fail('invalid-scene')

  const seen = new Set<string>()
  const objects: CanvasObject[] = []
  const validateObject = data.version === 1 ? isV1Object : isCanvasObject
  for (const object of scene.objects) {
    if (!validateObject(object)) return fail('invalid-object')
    if (seen.has(object.id)) return fail('duplicate-object')
    seen.add(object.id)
    objects.push(object)
  }
  if (invalidConnector(objects)) return fail('invalid-connection')
  return { ok: true, scene: { id: scene.id, objects } }
}
