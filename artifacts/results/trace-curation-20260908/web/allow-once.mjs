export default async function (page) {
  await page.getByRole('treeitem', { name: /Waiting for approval UAT approval gate/ }).click()
  await page.getByRole('button', { name: 'Allow once', exact: true }).click()
  await page.waitForFunction(() => !document.body.innerText.includes('Waiting for approval') && !document.querySelector('button[aria-label="Stop generation"]'), { timeout: 60000 })
}
