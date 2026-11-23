export async function readLocalProject(file: File) {
  return new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
}

export function downloadLocalProject(name: string, content: string) {
  downloadLocalFile(`${name}.json`, content, 'application/json;charset=utf-8')
}

export function downloadLocalFile(filename: string, content: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
  try {
    link.click()
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
  }
}
