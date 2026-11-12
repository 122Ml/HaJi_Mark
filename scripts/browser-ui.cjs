// Shared interactions with the actual Ant Design controls used by the app.
const selectRoot = input => input.locator('xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," ant-select ")][1]');
async function choose(locator, target) {
  const page = locator.page();
  const input = locator.and(page.getByRole('combobox'));
  const root = selectRoot(input);
  const label = typeof target === 'string' ? ({ point: '知识点', code: '代码文本' }[target] || target) : target.label;
  if (label === undefined) throw Error('Choose a visible option label');
  await root.click();
  const popup = page.locator('.ant-select-dropdown:visible');
  if (await input.isEditable()) await input.fill(label.split('·')[0].trim());
  await page.waitForFunction(el => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.x >= 0 && r.right <= innerWidth && r.y >= 0 && r.bottom <= innerHeight;
  }, await popup.elementHandle());
  const escaped = label.split(/\s*·\s*/).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*·\\s*');
  await popup.locator('.ant-select-item-option-content').filter({ hasText: new RegExp('^' + escaped + '(?:（草稿）)?$') }).last().click();
  await popup.waitFor({ state: 'hidden' });
}
async function selectedText(locator) {
  const input = locator.and(locator.page().getByRole('combobox'));
  return selectRoot(input).locator('.ant-select-selection-item').innerText();
}
async function optionCount(locator) {
  const page = locator.page(), input = locator.and(page.getByRole('combobox'));
  await selectRoot(input).click();
  const popup = page.locator('.ant-select-dropdown:visible');
  await popup.waitFor();
  const count = await popup.locator('.ant-select-item-option').count();
  await input.press('Escape');
  return count;
}
async function selectFile(button, files) {
  const [chooser] = await Promise.all([button.page().waitForEvent('filechooser'), button.click()]);
  await chooser.setFiles(files);
}
module.exports = { choose, selectedText, selectRoot, optionCount, selectFile };
