import { hasExactKeys, isDataRecord, isNonBlankString, type CanvasObject } from './scene'

export const maxImageBytes = 10 * 1024 * 1024
export const maxProjectImageBytes = 40 * 1024 * 1024
export const maxImagePixels = 16_000_000

export type ImageMime = 'image/png' | 'image/jpeg'
type ImageHeader = Readonly<{ mime: ImageMime; width: number; height: number }>
export type ImageAsset = ImageHeader & Readonly<{ id: string; data: string }>

const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10]
const jpegFrames = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])
const crcTable = Uint32Array.from({ length: 256 }, (_, i) => {
  for (let bit = 0; bit < 8; bit++) i = (i >>> 1) ^ (i & 1 ? 0xedb88320 : 0)
  return i
})

function* jpegSegments(bytes: Uint8Array, view: DataView) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return
  let offset = 2
  while (offset < bytes.length) {
    if (bytes[offset++] !== 0xff) return
    while (bytes[offset] === 0xff) offset++
    const marker = bytes[offset++]
    if (!marker || marker === 0xd9 || offset + 2 > bytes.length) return
    const length = view.getUint16(offset)
    if (length < 2 || offset + length > bytes.length) return
    yield { marker, offset, length }
    if (marker === 0xda) return
    offset += length
  }
}

export function supportedImageSize(width: number, height: number) {
  return Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0 && width * height <= maxImagePixels
}

/** Inspect dimensions before sending untrusted bytes to a browser decoder. */
export function imageHeader(bytes: Uint8Array): ImageHeader | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.length >= 33 && pngSignature.every((byte, index) => bytes[index] === byte) &&
      view.getUint32(8) === 13 && view.getUint32(12) === 0x49484452) {
    return { mime: 'image/png', width: view.getUint32(16), height: view.getUint32(20) }
  }
  for (const { marker, offset, length } of jpegSegments(bytes, view)) {
    if (jpegFrames.has(marker)) {
      if (length < 11 || length !== 8 + 3 * bytes[offset + 7]) return
      return { mime: 'image/jpeg', width: view.getUint16(offset + 5), height: view.getUint16(offset + 3) }
    }
  }
}

// This is format/container validation, not pixel decoding. The browser separately verifies decode.
export function hasImagePayload(bytes: Uint8Array, mime: ImageMime) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (mime === 'image/png') {
    let payload = false
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const length = view.getUint32(offset), type = view.getUint32(offset + 4)
      const checksumAt = offset + 8 + length
      if (checksumAt + 4 > bytes.length) return false
      let crc = 0xffffffff
      for (let i = offset + 4; i < checksumAt; i++) crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[i]) & 255]
      if (((crc ^ 0xffffffff) >>> 0) !== view.getUint32(checksumAt)) return false
      if (type === 0x49444154 && length > 0) payload = true // IDAT
      if (type === 0x49454e44) return payload && length === 0 // IEND
      offset = checksumAt + 4
    }
  } else {
    for (const { marker, offset, length } of jpegSegments(bytes, view)) {
      if (marker !== 0xda || length < 8) continue // SOS
      const start = offset + length
      for (let i = start + 1; i + 1 < bytes.length; i++) if (bytes[i] === 0xff && bytes[i + 1] === 0xd9) return true // EOI
    }
  }
  return false
}

export function inspectImage(bytes: Uint8Array) {
  if (bytes.byteLength > maxImageBytes) return
  const header = imageHeader(bytes)
  if (header && supportedImageSize(header.width, header.height)) return header
}

export function imageAssetBytes(asset: Pick<ImageAsset, 'data'>) {
  return asset.data.length / 4 * 3 - (asset.data.endsWith('==') ? 2 : asset.data.endsWith('=') ? 1 : 0)
}

export function isImageAsset(value: unknown): value is ImageAsset {
  if (!isDataRecord(value) || !hasExactKeys(value, ['id', 'mime', 'width', 'height', 'data']) ||
      !isNonBlankString(value.id) || typeof value.width !== 'number' || typeof value.height !== 'number' ||
      !supportedImageSize(value.width, value.height) || typeof value.data !== 'string' || value.data.length === 0 ||
      value.data.length % 4 !== 0 || value.data.length > Math.ceil(maxImageBytes / 3) * 4 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(value.data) || imageAssetBytes({ data: value.data }) > maxImageBytes) return false
  try {
    const binary = atob(value.data)
    if (btoa(binary) !== value.data) return false
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    const header = inspectImage(bytes)
    return !!header && header.mime === value.mime && header.width === value.width && header.height === value.height && hasImagePayload(bytes, header.mime)
  } catch {
    return false
  }
}

export function imageAssetsForObjects(objects: readonly CanvasObject[], assets: readonly ImageAsset[]) {
  const used = new Set(objects.flatMap(object => object.type === 'image' ? [object.assetId] : []))
  const active: ImageAsset[] = []
  let size = 0
  for (const asset of assets) {
    if (!used.delete(asset.id)) continue
    size += imageAssetBytes(asset)
    if (size > maxProjectImageBytes) return
    active.push(asset)
  }
  return used.size ? undefined : active
}

export function imageDataUrl(asset: ImageAsset) {
  return `data:${asset.mime};base64,${asset.data}`
}
