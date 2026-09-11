export default async function (page) {
  await page.getByRole('button', { name: 'Choose workspace', exact: true }).click()
  await page.getByRole('button', { name: 'Edit path', exact: true }).click()
  const field = page.getByRole('dialog').getByRole('textbox')
  await field.fill('/home/andrea/management/deepseek-harness/artifacts/results/trace-curation-20260908/web')
  await field.press('Enter')
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden', timeout: 20000 })
}
