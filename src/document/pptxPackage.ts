import { safeUnzipSync } from '@web-ppt/core/zip'
import { acceptablePageSize, maxDocumentPages, maxSourceText } from '../core/document'

export const pptxZipLimits = { maxEntries: 2000, maxEntryBytes: 32 * 1024 * 1024, maxTotalBytes: 128 * 1024 * 1024 }
const packageRelations = 'http://schemas.openxmlformats.org/package/2006/relationships'
const contentTypes = 'http://schemas.openxmlformats.org/package/2006/content-types'
const officeRelations = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const presentationNs = 'http://schemas.openxmlformats.org/presentationml/2006/main'
const drawingNs = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const manifest = 'ppt/presentation.xml'
const manifestRels = 'ppt/_rels/presentation.xml.rels'

export class PptxInputError extends Error {}

function xml(bytes: Uint8Array | undefined, namespace: string, element: string) {
  if (!bytes) throw new PptxInputError('PPTX 缺少所需的文档内容。')
  const doc = new DOMParser().parseFromString(decodeXml(bytes), 'application/xml')
  if (doc.doctype || doc.documentElement.namespaceURI !== namespace || doc.documentElement.localName !== element) {
    throw new PptxInputError('PPTX 的文档结构无效或不受支持。')
  }
  return doc.documentElement
}

function decodeXml(bytes: Uint8Array) {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    const encoding = /^<\?xml\s[^?]*?\bencoding\s*=\s*(['"])([^'"]+)\1/i.exec(text)?.[2].toLowerCase()
    if (text.includes('\0') || (encoding && encoding !== 'utf-8')) throw new Error()
    return text
  } catch { throw new PptxInputError('PPTX 包含不支持的 XML 编码；请用 PowerPoint 另存为 .pptx 后重试。') }
}

function internalPart(path: string, target: string) {
  if (target.includes('\\') || target.includes('?')) throw new PptxInputError('PPTX 的文档引用无效。')
  const owner = path === '_rels/.rels' ? '' : path.replace(/(^|\/)_rels\/([^/]+)\.rels$/, '$1$2')
  const url = new URL(target, `https://package.invalid/${owner}`)
  if (url.origin !== 'https://package.invalid') throw new PptxInputError('PPTX 包含不支持的外部引用。')
  return decodeURIComponent(url.pathname.slice(1))
}

export function readPptxPackage(bytes: Uint8Array) {
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) {
    throw new PptxInputError('不支持加密的 PPTX 或旧版 .ppt 文件。')
  }
  const entriesInZip = new Set<string>()
  const parts = safeUnzipSync(bytes, { limits: pptxZipLimits, filter: ({ name }) => {
    if (/vbaProject|vbaData/i.test(name)) throw new PptxInputError('不支持含宏的 PowerPoint 文件。')
    entriesInZip.add(name)
    return name === '[Content_Types].xml' || name.endsWith('.rels') || (name.startsWith('ppt/') && name.endsWith('.xml'))
  } })
  for (const [path, data] of Object.entries(parts)) if (path !== '[Content_Types].xml' && path.endsWith('.xml')) decodeXml(data)
  const types = xml(parts['[Content_Types].xml'], contentTypes, 'Types')
  for (const node of types.children) {
    if (/macroEnabled|vbaProject/i.test(node.getAttribute('ContentType') ?? '')) throw new PptxInputError('不支持含宏的 PowerPoint 文件。')
  }
  if (![...types.children].some(node => node.getAttribute('PartName') === `/${manifest}` &&
      node.getAttribute('ContentType') === 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml')) {
    throw new PptxInputError('请选择标准的 .pptx 演示文稿。')
  }
  const slideRelations = new Map<string, string>()
  for (const path of Object.keys(parts).filter(path => path.endsWith('.rels'))) {
    const root = xml(parts[path], packageRelations, 'Relationships')
    const ids = new Set<string>()
    for (const node of root.children) {
      const target = node.getAttribute('Target'), type = node.getAttribute('Type'), id = node.getAttribute('Id')
      if (!id || !target || !type) throw new PptxInputError('PPTX 的文档引用无效。')
      if (ids.has(id)) throw new PptxInputError('PPTX 包含重复的文档引用。')
      ids.add(id)
      if (node.getAttribute('TargetMode')?.toLowerCase() === 'external' || (target && /^\s*(?:[a-z][\w+.-]*:|[/\\]{2})/i.test(target))) {
        throw new PptxInputError('PPTX 包含外部链接或资源；请删除链接或将资源嵌入后再打开。')
      }
      const part = internalPart(path, target)
      if (!entriesInZip.has(part)) throw new PptxInputError('PPTX 缺少所引用的内部内容或资源。')
      if (path !== manifestRels || type !== `${officeRelations}/slide`) continue
      slideRelations.set(id, part)
    }
  }
  const deck = xml(parts[manifest], presentationNs, 'presentation')
  const dimensions = [...deck.children].find(node => node.namespaceURI === presentationNs && node.localName === 'sldSz')
  const width = Number(dimensions?.getAttribute('cx')) / 12700, height = Number(dimensions?.getAttribute('cy')) / 12700
  if (!acceptablePageSize(width, height)) throw new PptxInputError('PPTX 的页面尺寸无效或超限。')
  const list = [...deck.children].find(node => node.namespaceURI === presentationNs && node.localName === 'sldIdLst')
  const entries = list ? [...list.children] : []
  if (entries.length < 1 || entries.length > maxDocumentPages) throw new PptxInputError(`PPTX 页数须在 1～${maxDocumentPages} 页之间。`)
  const seen = new Set<string>()
  const slides = entries.map(entry => {
    const part = slideRelations.get(entry.getAttributeNS(officeRelations, 'id') ?? '')
    if (!part || seen.has(part)) throw new PptxInputError('PPTX 的幻灯片引用无效。')
    seen.add(part)
    const slide = xml(parts[part], presentationNs, 'sld')
    let text = ''
    // Use authored slide text (including table cells), not speaker notes, layout placeholders, or OCR.
    for (const paragraph of slide.getElementsByTagNameNS(drawingNs, 'p')) {
      let line = ''
      for (const run of paragraph.getElementsByTagNameNS(drawingNs, 't')) {
        line += run.textContent?.slice(0, maxSourceText - line.length) ?? ''
        if (line.length === maxSourceText) break
      }
      if (!line.trim()) continue
      text += (text ? '\n' + line : line).slice(0, maxSourceText - text.length)
      if (text.length === maxSourceText) break
    }
    return { part, text: text.trim() || null }
  })
  return { width, height, slides }
}
