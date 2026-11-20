import { hasExactKeys, isCanvasObject, isDataRecord, isNonBlankString, type CanvasObject, type CanvasScene } from '../core/scene'

const format = 'document-vector-canvas'
const version = 1

const messages = {
  'invalid-json': '项目文件不是有效的 JSON。',
  'unsupported-format': '这不是文档矢量画布的项目文件。',
  'unsupported-version': '当前应用不支持这个项目版本。',
  'invalid-scene': '项目中的画布数据无效。',
  'invalid-object': '项目中有未知类型或属性无效的图元。',
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
  if (data.version !== version) return fail('unsupported-version')
  if (!hasExactKeys(data, ['format', 'version', 'scene'])) return fail('invalid-scene')
  const scene = data.scene
  if (!isDataRecord(scene) || !hasExactKeys(scene, ['id', 'objects']) ||
      !isNonBlankString(scene.id) || !Array.isArray(scene.objects)) return fail('invalid-scene')

  const seen = new Set<string>()
  const objects: CanvasObject[] = []
  for (const object of scene.objects) {
    if (!isCanvasObject(object)) return fail('invalid-object')
    if (seen.has(object.id)) return fail('duplicate-object')
    seen.add(object.id)
    objects.push(object)
  }
  return { ok: true, scene: { id: scene.id, objects } }
}
