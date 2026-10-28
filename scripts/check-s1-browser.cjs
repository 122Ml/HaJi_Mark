// Requires Playwright (bundled desktop runtime or a local development install).
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const fixtures = JSON.parse(fs.readFileSync(path.join(root, '.local/s1-accounts.json'), 'utf8'));
const check = eval('(' + fs.readFileSync(path.join(__dirname, 'frontend-browser-check.js'), 'utf8') + ')');
(async () => {
  const browser = await chromium.launch({channel:'msedge',headless:true});
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    console.log(JSON.stringify(await check(page, fixtures.accounts), null, 2));
  } finally { await browser.close(); }
})().catch(error => {
  let message = error.message;
  for (const account of fixtures.accounts) message = message.replaceAll(account.password, '[redacted]');
  console.error(message);
  process.exitCode = 1;
});
