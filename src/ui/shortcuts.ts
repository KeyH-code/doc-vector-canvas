export type EditingShortcut = 'undo' | 'redo' | 'copy' | 'paste' | 'delete'

function isInput(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || !!target.closest('input, textarea, select'))
}

export function isTemporaryHandKey(event: KeyboardEvent) {
  return event.code === 'Space' && !event.defaultPrevented && !event.isComposing && !event.altKey && !event.ctrlKey && !event.metaKey &&
    !isInput(event.target) && !(event.target instanceof Element && event.target.closest('button, [role="separator"]'))
}

export function editingShortcut(event: KeyboardEvent): EditingShortcut | undefined {
  if (event.defaultPrevented || event.isComposing || event.altKey) return
  if (isInput(event.target)) return
  const key = event.key.toLowerCase()
  if (event.ctrlKey || event.metaKey) {
    if (key === 'z') return event.shiftKey ? 'redo' : 'undo'
    if (key === 'y') return 'redo'
    if (key === 'c') return 'copy'
    if (key === 'v') return 'paste'
  } else if (key === 'delete' || key === 'backspace') return 'delete'
}
