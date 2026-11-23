import { hasImagePayload, imageDataUrl, imageHeader, maxImageBytes, supportedImageSize, type ImageAsset } from '../core/imageAssets'

const decoded = new WeakMap<ImageAsset, HTMLImageElement>()

export function preparedImage(asset: ImageAsset) {
  return decoded.get(asset)
}

export function sharePreparedImage(source: ImageAsset, target: ImageAsset) {
  const image = decoded.get(source)
  if (image) decoded.set(target, image)
}

export async function prepareImage(asset: ImageAsset) {
  const cached = decoded.get(asset)
  if (cached) return cached
  const image = new Image()
  image.src = imageDataUrl(asset)
  try {
    await image.decode()
  } catch {
    throw new Error('图片内容损坏，无法解码。')
  }
  const { naturalWidth: width, naturalHeight: height } = image
  const same = width === asset.width && height === asset.height
  const rotatedJpeg = asset.mime === 'image/jpeg' && width === asset.height && height === asset.width
  if (!supportedImageSize(width, height) || (!same && !rotatedJpeg)) throw new Error('图片的实际尺寸与文件不一致。')
  decoded.set(asset, image)
  return image
}

export async function readImageAsset(file: File, id: string) {
  if (file.size > maxImageBytes) throw new Error('单张图片不能超过 10 MiB。')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const header = imageHeader(bytes)
  if (!header) throw new Error('请选择内容有效的 PNG 或 JPG 图片。')
  if (!supportedImageSize(header.width, header.height)) throw new Error('图片尺寸无效或超过 1600 万像素。')
  if (!hasImagePayload(bytes, header.mime)) throw new Error('图片内容损坏，无法解码。')
  const chunks: string[] = []
  for (let i = 0; i < bytes.length; i += 0x8000) chunks.push(String.fromCharCode(...bytes.subarray(i, i + 0x8000)))
  const asset: ImageAsset = { id, ...header, data: btoa(chunks.join('')) }
  const image = await prepareImage(asset)
  return { asset, width: image.naturalWidth, height: image.naturalHeight }
}
