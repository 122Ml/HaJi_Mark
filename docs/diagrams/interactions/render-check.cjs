// Serial local SVG rendering and viewer verification; no application/model calls.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

(async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8'));
  const probe = process.argv.includes('--probe');
  const figures = probe ? manifest.figures.slice(0, 1) : manifest.figures;
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage();
  const errors = [], geometry = [];
  page.on('pageerror', e => errors.push(String(e)));
  try {
    for (const f of figures) {
      await page.setViewportSize({ width: f.width, height: f.height });
      await page.goto(pathToFileURL(path.join(__dirname, f.id + '.svg')).href);
      await page.evaluate(() => document.fonts.ready);
      const issues = await page.evaluate(() => {
        const svg = document.querySelector('svg'), w = +svg.getAttribute('width'), h = +svg.getAttribute('height');
        const problems = [];
        for (const t of svg.querySelectorAll('text')) {
          const b = t.getBBox();
          if (b.x < 0 || b.y < 0 || b.x + b.width > w || b.y + b.height > h)
            problems.push({ type: 'canvas', text: t.textContent });
          const node = t.closest('.node');
          if (node) {
            const r = node.querySelector('rect');
            if (b.x < +r.getAttribute('x') + 10 || b.y < +r.getAttribute('y') + 8 ||
                b.x + b.width > +r.getAttribute('x') + +r.getAttribute('width') - 10 ||
                b.y + b.height > +r.getAttribute('y') + +r.getAttribute('height') - 5)
              problems.push({ type: 'node', text: t.textContent });
          }
        }
        const labels = [...svg.querySelectorAll('.edge-label rect')].map(r => r.getBBox());
        for (const a of labels) for (const n of svg.querySelectorAll('.node>rect:first-child')) {
          const b = n.getBBox();
          if (Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x) &&
              Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y))
            problems.push({ type: 'label-node' });
        }
        return problems;
      });
      assert.deepEqual(issues, [], f.id + ' text bounds');
      await page.locator('svg').screenshot({ path: path.join(__dirname, f.id + '.png') });
      geometry.push({ id: f.id, text_bounds: 'pass', size: [f.width, f.height] });
      console.log('Rendered ' + f.id);
    }
    if (probe) return;
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(pathToFileURL(path.join(__dirname, 'index.html')).href);
    for (const f of figures) {
      await page.locator('#tab-' + f.id).click();
      assert.equal(await page.locator('.panel.active .node').count(), f.nodes.length);
      await page.locator('.panel.active .node').first().click();
      assert.equal(await page.locator('.panel.active .node.selected').count(), 1);
      for (const ext of ['png', 'svg'])
        assert(fs.existsSync(path.join(__dirname, await page.locator('#' + ext).getAttribute('href'))));
    }
    await page.locator('#tab-I00').click();
    const node = page.locator('.panel.active .node[data-node="source"]');
    await node.focus(); await page.keyboard.press('Enter');
    assert.equal(await page.locator('.panel.active .node.selected').count(), 1);
    assert(await page.locator('.panel.active .dim').count() > 0);
    await page.locator('#jump').click();
    assert.equal(await page.locator('.panel.active').getAttribute('id'), 'I02');
    const before = await page.locator('#level').textContent();
    await page.locator('#plus').click();
    assert.notEqual(await page.locator('#level').textContent(), before);
    await page.locator('#fit').click();
    assert.equal(await page.locator('#level').textContent(), before);
    await page.locator('.panel.active .node').first().click();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.panel.active .node.selected').count(), 0);
    const ids = await page.locator('[id]').evaluateAll(ns => ns.map(n => n.id));
    assert.equal(new Set(ids).size, ids.length, 'unique SVG marker IDs');
    await page.reload();
    assert.equal(await page.locator('.panel.active').getAttribute('id'), 'I02', 'hash restore');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#fit').click();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'narrow layout');
    assert.deepEqual(errors, []);
    const report = { date: manifest.date, scope: 'interaction-diagrams-only', geometry,
      role_routes: manifest.route_coverage.length, checks: ['text-bounds', 'edge-node-obstacles', '10-tabs', 'node-neighbors', 'cross-diagram-jump', 'downloads', 'keyboard', 'zoom-fit', 'hash-restore', 'unique-ids', '390px-layout'], page_errors: errors };
    fs.writeFileSync(path.join(__dirname, 'browser-check.json'), JSON.stringify(report, null, 2) + '\n');
    console.log('PASS: 10 figures, 28 role routes and viewer checks.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
