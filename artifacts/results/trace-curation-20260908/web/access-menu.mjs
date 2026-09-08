export default async function (page) {
  await page.getByRole('button', { name: 'Access mode, current: Workspace Write', exact: true }).click()
}
