export function fromBase64(data: string): Uint8Array<ArrayBuffer> {
  const decoded = atob(data), bytes = new Uint8Array(decoded.length)
  for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i)
  return bytes
}

export function toBase64(data: Uint8Array) {
  const items: string[] = []
  for (let i = 0; i < data.length; i += 32768) items.push(String.fromCharCode(...data.subarray(i, i + 32768)))
  return btoa(items.join(''))
}
