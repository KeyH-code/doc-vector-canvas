import { hasExactKeys, isCanvasObject, isDataRecord, isNonBlankString, type CanvasObject, type CanvasScene } from '../core/scene'
import { invalidConnector, isConnector } from '../core/connections'
import { imageAssetBytes, imageAssetsForObjects, isImageAsset, maxProjectImageBytes, type ImageAsset } from '../core/imageAssets'
import { acceptablePageSize, documentImagesWithinLimit, isPdfData, maxDocumentPages, maxSourceText, type DocumentPage } from '../core/document'

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
  'invalid-image': '项目中的图片资源损坏、超限或引用无效。',
  'invalid-document': '文档项目的页面或底稿数据无效。',
  'duplicate-object': '项目中有重复的图元 ID。',
} as const

type ProjectFileError = { ok: false; code: keyof typeof messages; message: string }
export type ProjectFileResult = { ok: true; scene: CanvasScene } | ProjectFileError

function fail(code: ProjectFileError['code']): ProjectFileError {
  return { ok: false, code, message: messages[code] }
}

export function encodeProject(scene: CanvasScene): string {
  if (scene.document) return JSON.stringify({ format, version: 3, scene: { id: scene.id, document: scene.document } }, null, 2)
  return JSON.stringify({ format, version, scene: { id: scene.id, objects: scene.objects, ...(scene.images ? { images: scene.images } : {}) } }, null, 2)
}

export function decodeProject(source: string): ProjectFileResult {
  let data: unknown
  try {
    data = JSON.parse(source)
  } catch {
    return fail('invalid-json')
  }

  if (!isDataRecord(data) || data.format !== format) return fail('unsupported-format')
  if (data.version !== 1 && data.version !== version && data.version !== 3) return fail('unsupported-version')
  if (!hasExactKeys(data, ['format', 'version', 'scene'])) return fail('invalid-scene')
  return data.version === 3 ? decodeDocument(data.scene) : decodeScene(data.scene, data.version)
}

function decodeDocument(scene: unknown): ProjectFileResult {
  if (!isDataRecord(scene) || !hasExactKeys(scene, ['id', 'document']) || !isNonBlankString(scene.id)) return fail('invalid-document')
  const document = scene.document
  if (!isDataRecord(document) || !hasExactKeys(document, ['source', 'pages']) || !isDataRecord(document.source) ||
      !hasExactKeys(document.source, ['kind', 'data']) || document.source.kind !== 'pdf' || !isPdfData(document.source.data) ||
      !Array.isArray(document.pages) || document.pages.length === 0 || document.pages.length > maxDocumentPages) return fail('invalid-document')
  const ids = new Set<string>(), pages: DocumentPage[] = []
  for (const item of document.pages) {
    if (!isDataRecord(item) || !hasExactKeys(item, ['id', 'width', 'height', 'text', 'scene']) || !isNonBlankString(item.id) || ids.has(item.id) ||
        typeof item.width !== 'number' || typeof item.height !== 'number' || !acceptablePageSize(item.width, item.height) ||
        (item.text !== null && (typeof item.text !== 'string' || item.text.length > maxSourceText))) return fail('invalid-document')
    const page = decodeScene(item.scene, 2)
    if (!page.ok) return page
    if (page.scene.id !== item.id) return fail('invalid-document')
    ids.add(item.id)
    pages.push({ id: item.id, width: item.width, height: item.height, text: item.text, scene: page.scene })
  }
  if (!documentImagesWithinLimit(pages)) return fail('invalid-image')
  return { ok: true, scene: { id: scene.id, objects: [], document: { source: { kind: 'pdf', data: document.source.data }, pages } } }
}

function decodeScene(scene: unknown, fileVersion: 1 | 2): ProjectFileResult {
  if (!isDataRecord(scene) || !isNonBlankString(scene.id) || !Array.isArray(scene.objects)) return fail('invalid-scene')
  const hasImages = fileVersion === version && Object.hasOwn(scene, 'images')
  if (!hasExactKeys(scene, hasImages ? ['id', 'objects', 'images'] : ['id', 'objects'])) return fail('invalid-scene')

  const seen = new Set<string>()
  const objects: CanvasObject[] = []
  const validateObject = fileVersion === 1 ? isV1Object : isCanvasObject
  for (const object of scene.objects) {
    if (!validateObject(object)) return fail('invalid-object')
    if (seen.has(object.id)) return fail('duplicate-object')
    seen.add(object.id)
    objects.push(object)
  }
  const images: ImageAsset[] = [], imageIds = new Set<string>()
  let size = 0
  if (hasImages) {
    if (!Array.isArray(scene.images)) return fail('invalid-image')
    for (const asset of scene.images) {
      if (!isImageAsset(asset) || imageIds.has(asset.id)) return fail('invalid-image')
      size += imageAssetBytes(asset)
      if (size > maxProjectImageBytes) return fail('invalid-image')
      imageIds.add(asset.id)
      images.push(asset)
    }
  }
  if (imageAssetsForObjects(objects, images)?.length !== images.length) return fail('invalid-image')
  if (invalidConnector(objects)) return fail('invalid-connection')
  return { ok: true, scene: { id: scene.id, objects, ...(images.length ? { images } : {}) } }
}
