// Local diagram only; no service writes or model calls.
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1840, height: 1690 } });
    await page.goto(pathToFileURL(path.join(__dirname, 'agent/architecture.svg')).href);
    await page.evaluate(() => document.fonts.ready);
    const errors = await page.evaluate(() => [...document.querySelectorAll('text')].filter(t => {
      const r = t.getBoundingClientRect();
      const prev = t.previousElementSibling;
      const b = prev?.tagName === 'rect' ? prev.getBoundingClientRect() : null;
      return r.x < 0 || r.y < 0 || r.right > 1840 || r.bottom > 1690 || (b && r.right > b.right - 8);
    }).map(t => t.textContent));
    assert.deepEqual(errors, [], 'Diagram text bounds');
    await page.locator('svg').screenshot({ path: path.join(__dirname, 'agent/architecture.png') });
    console.log('PASS Agent architecture PNG and SVG text bounds');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
