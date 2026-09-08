export default async function (page) {
  await page.getByRole('treeitem', { name: /UAT approval gate and file write/ }).click()
  await page.getByRole('button', {name:'Stop generating',exact:true}).waitFor({state:'hidden',timeout:60000})
  await page.getByRole('textbox',{name:'Message or run a task... / commands, @ files or sessions',exact:true}).fill('Run the rejection branch of this authorized approval UAT. Use write to create exactly NO in /home/andrea/management/deepseek-harness/artifacts/results/trace-curation-20260908/approval-rejected.txt. If workspace-write denies it, retry that exact write with sandbox_permissions danger-full-access and justification to request approval. If approval is rejected, stop and report rejection; do not bypass it or change any other file.')
  await page.getByRole('button',{name:'Send message',exact:true}).click()
  await page.getByRole('button',{name:'Reject',exact:true}).waitFor({timeout:60000})
  await page.screenshot({path:new URL('./reject-pending.png',import.meta.url).pathname})
  await page.getByRole('button',{name:'Reject',exact:true}).click()
  await page.getByRole('button',{name:'Stop generating',exact:true}).waitFor({state:'hidden',timeout:60000})
}
