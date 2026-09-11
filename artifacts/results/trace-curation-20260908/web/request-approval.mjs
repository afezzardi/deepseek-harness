export default async function (page) {
  const field = page.getByRole('textbox', { name: 'Describe what you want to build... / commands, @ files or sessions', exact: true })
  await field.fill('This is an authorized approval-gate UAT. Use the write tool to write exactly OK to /home/andrea/management/deepseek-harness/artifacts/results/trace-curation-20260908/approval-allowed.txt. This is outside this session workspace. If the first write is sandbox denied, request approval by retrying that exact write with the narrowest sufficient sandbox_permissions and a justification. Do not change any other file. After the approval decision, report the actual result.')
  await page.getByRole('button', { name: 'Send message', exact: true }).click()
  await page.waitForFunction(() => /Approve|Allow once|Allow Once|Deny|Reject/.test(document.body.innerText), { timeout: 60000 })
}
