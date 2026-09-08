export default async function (page) {
  await page.getByRole('button', { name: 'Choose workspace', exact: true }).click()
}
