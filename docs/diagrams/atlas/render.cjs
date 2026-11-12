// Render each self-contained SVG and reject clipped text before saving PNG.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

(async () => {
  const dir = __dirname;
  const figures = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    for (const figure of figures) {
      await page.goto(pathToFileURL(path.join(dir, figure.id + '.svg')).href);
      await page.evaluate(() => document.fonts.ready);
      const clipped = await page.evaluate(() => {
        const svg = document.querySelector('svg');
        const width = Number(svg.getAttribute('width'));
        const height = Number(svg.getAttribute('height'));
        return [...svg.querySelectorAll('text')].filter(node => {
          const b = node.getBBox();
          return b.x < 0 || b.y < 0 || b.x + b.width > width || b.y + b.height > height;
        }).map(node => node.textContent);
      });
      if (clipped.length) throw new Error(figure.id + ' clipped: ' + clipped.join(' / '));
      await page.locator('svg').screenshot({ path: path.join(dir, figure.id + '.png') });
      process.stdout.write(figure.id + ' rendered\n');
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(pathToFileURL(path.join(dir, 'index.html')).href);
    for (const figure of figures) {
      await page.locator('nav button[data-id="' + figure.id + '"]').click();
      if (await page.locator('#image').getAttribute('src') !== figure.id + '.svg')
        throw new Error('Viewer failed for ' + figure.id);
      if (!await page.locator('#image').evaluate(image => image.complete && image.naturalWidth > 0))
        throw new Error('Viewer image failed for ' + figure.id);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('nav button[data-id="F01"]').click();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    if (overflow) throw new Error('Viewer has page-level mobile overflow');
    process.stdout.write('Viewer desktop/mobile passed\n');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
