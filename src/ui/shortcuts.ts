export type EditingShortcut = 'undo' | 'redo' | 'copy' | 'paste' | 'delete'

export function editingShortcut(event: KeyboardEvent): EditingShortcut | undefined {
  if (event.defaultPrevented || event.isComposing || event.altKey) return
  if (event.target instanceof HTMLElement &&
    (event.target.isContentEditable || event.target.closest('input, textarea, select'))) return
  const key = event.key.toLowerCase()
  if (event.ctrlKey || event.metaKey) {
    if (key === 'z') return event.shiftKey ? 'redo' : 'undo'
    if (key === 'y') return 'redo'
    if (key === 'c') return 'copy'
    if (key === 'v') return 'paste'
  } else if (key === 'delete' || key === 'backspace') return 'delete'
}
