import type { Page } from '@playwright/test'

export async function chooseLine(page: Page, name: '直线' | '箭头') {
  await page.getByRole('button', { name: name === '直线' ? '线条' : '箭头', exact: true }).click()
  await page.getByRole('button', { name: name === '直线' ? '直线' : '直线箭头', exact: true }).click()
}
