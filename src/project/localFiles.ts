export async function readLocalProject(file: File) {
  return new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
}

export function downloadLocalProject(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `${name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')}.json`
  try {
    link.click()
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
  }
}
