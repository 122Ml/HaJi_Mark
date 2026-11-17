// Render serially and verify the local diagram viewer; no application/model calls.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

(async () => {
  const out = path.join(__dirname, 'current');
  const structure = JSON.parse(fs.readFileSync(path.join(out, 'structure-check.json'), 'utf8'));
  const files = structure.figures;
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  const geometry = [];
  try {
    for (const item of files) {
      await page.setViewportSize({ width: item.size[0], height: item.size[1] });
      await page.goto(pathToFileURL(path.join(out, item.file + '.svg')).href);
      await page.evaluate(() => document.fonts.ready);
      const problems = await page.evaluate(() => {
        const issues = [], svg = document.querySelector('svg');
        const w = Number(svg.getAttribute('width')), h = Number(svg.getAttribute('height'));
        for (const t of svg.querySelectorAll('text')) {
          const b = t.getBBox();
          // getBoundingClientRect includes ancestor transforms unlike getBBox.
          const r = t.getBoundingClientRect();
          if (r.x < -1 || r.y < -1 || r.right > w+1 || r.bottom > h+1)
            issues.push({ type:'canvas', text:t.textContent });
          const n = t.closest('.node,.runtime-component');
          if (n) {
            const box = n.querySelector('rect');
            const x = Number(box.getAttribute('x')), y = Number(box.getAttribute('y'));
            const nw = Number(box.getAttribute('width')), nh = Number(box.getAttribute('height'));
            // Implementation badges straddle the top border intentionally.
            if (b.y > y+15 && (b.x < x+10 || b.x+b.width > x+nw-10 || b.y+b.height > y+nh-6))
              issues.push({ type:'node', text:t.textContent });
          }
        }
        for (const label of svg.querySelectorAll('.edge-label rect')) {
          const a = label.getBoundingClientRect();
          for (const n of svg.querySelectorAll('.node > rect:first-child')) {
            const b = n.getBoundingClientRect();
            if (Math.min(a.right,b.right)-Math.max(a.left,b.left)>5 && Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>5)
              issues.push({ type:'label-over-node', text:label.parentElement.querySelector('text').textContent });
          }
        }
        return issues;
      });
      assert.deepEqual(problems, [], item.file + ' text geometry');
      await page.locator('svg').screenshot({ path:path.join(out, item.file+'.png') });
      geometry.push({file:item.file, text_bounds:'pass', png_size:item.size});
      process.stdout.write('Rendered '+item.file+'\n');
    }
    await page.setViewportSize({ width:1440, height:1000 });
    await page.goto(pathToFileURL(path.join(out, 'index.html')).href);
    await page.locator('.panel.active .node[data-node="knowledge"]').click();
    assert(await page.locator('.panel.active .node.selected').count() === 1);
    assert(await page.locator('.panel.active .node.dim').count() > 0);
    await page.locator('#module').selectOption('questions');
    assert(await page.locator('.panel.active .node.selected').count() === 3);
    await page.locator('#module').selectOption('agent');
    assert(await page.locator('.panel.active .node.selected').count() === 6);
    assert(await page.locator('.panel.active .node[data-node="learning"]').getAttribute('data-status') === 'done');
    assert(await page.locator('.panel.active .node[data-node="qa"]').getAttribute('data-status') === 'partial');
    assert(await page.locator('.panel.active .node[data-node="agent-coverage"]').getAttribute('data-status') === 'partial');
    assert(await page.locator('.panel.active .node[data-node="answers"] [data-item-status="planned"]').count() === 1);
    assert(await page.locator('.panel.active .implementation-legend').textContent().then(t => ['完全实现', '部分实现', '未实现'].every(s => t.includes(s))));
    await page.locator('#boundaries').uncheck();
    assert(await page.locator('.panel.active .canvas.hide-modules').count() === 1);
    await page.locator('#boundaries').check();
    await page.locator('#reset').click();
    assert(await page.locator('.panel.active .dim').count() === 0);
    const initial = await page.locator('#level').textContent();
    await page.locator('#plus').click();
    assert(await page.locator('#level').textContent() !== initial);
    await page.locator('#fit').click();
    assert(await page.locator('#level').textContent() === initial);
    for (let i=0;i<files.length;i++) {
      await page.locator('nav button').nth(i).click();
      assert(await page.locator('.panel.active .node').count() === files[i].nodes);
      for (const ext of ['svg','png']) {
        const href = await page.locator('#'+ext+'-link').getAttribute('href');
        assert(fs.existsSync(path.join(out,href)));
      }
    }
    await page.locator('nav button').nth(0).click();
    const n = page.locator('.panel.active .node[data-node="materials"]');
    await n.focus();
    await page.keyboard.press('Enter');
    assert(await page.locator('.panel.active .node.selected').count() === 1);
    await page.keyboard.press('Escape');
    assert(await page.locator('.panel.active .node.selected').count() === 0);
    const ids = await page.locator('[id]').evaluateAll(nodes=>nodes.map(n=>n.id));
    assert(new Set(ids).size === ids.length, 'duplicate inline SVG fragment IDs');
    await page.setViewportSize({width:390,height:844});
    await page.locator('#fit').click();
    assert(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth), 'viewer mobile overflow');
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(out,'browser-check.json'),JSON.stringify({
      scope:'diagrams-only', date:structure.date, code_baseline:structure.code_baseline, geometry,
      checks:['node-highlighting','module-filter','agent-module-filter','current-feature-status','module-boundaries','reset','zoom-fit','five-tabs','svg-png-links','keyboard','unique-svg-ids','390px-viewer'],
      page_errors:errors
    }, null, 2));
    process.stdout.write('PASS: diagram geometry, exports and 12 viewer checks.\n');
  } finally { await browser.close(); }
})().catch(e=>{process.stderr.write(String(e.stack)+'\n');process.exitCode=1;});
