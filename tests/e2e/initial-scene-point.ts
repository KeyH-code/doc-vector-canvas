import type { Page } from '@playwright/test'

// Opening a project restores the default world center. The viewport can be wider or taller than the legacy frame.
export async function initialScenePoint(page: Page, x: number, y: number) {
  const surface = page.getByTestId('canvas-stage').locator('canvas[data-fabric="main"]')
  const [box, zoom] = await Promise.all([surface.boundingBox(), page.getByRole('combobox', { name: '画布缩放' }).inputValue()])
  if (!box) throw new Error('画布尚不可见')
  return { x: box.x + box.width / 2 + (x - 500) * Number(zoom),
    y: box.y + box.height / 2 + (y - 500 * 450 / 760) * Number(zoom) }
}
