// Render serially and inspect actual browser text geometry, then exercise the gallery.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

(async () => {
  const dir = __dirname;
  const all = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const ids = process.argv.slice(2);
  const figures = ids.length ? all.filter(f => ids.includes(f.id)) : all;
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const report = [];
  try {
    const page = await browser.newPage();
    for (const figure of figures) {
      await page.goto(pathToFileURL(path.join(dir, figure.id + '.svg')).href);
      await page.evaluate(() => document.fonts.ready);
      const issues = await page.evaluate(() => {
        const svg = document.querySelector('svg');
        const width = Number(svg.getAttribute('width')), height = Number(svg.getAttribute('height'));
        const failures = [];
        const overlap = (a,b) => Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x)>2 && Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y)>2;
        for (const t of svg.querySelectorAll('text')) {
          const b = t.getBBox();
          if (b.x < -1 || b.y < -1 || b.x+b.width > width+1 || b.y+b.height > height+1)
            failures.push('canvas text: ' + t.textContent);
        }
        const nodes = [...svg.querySelectorAll('.node')];
        for (const n of nodes) {
          const rect = n.querySelector('rect');
          const b = rect.getBBox();
          const body = [...n.querySelectorAll('text')].filter(t => Number(t.getAttribute('y')) > b.y+16);
          for (const t of body) {
            const a = t.getBBox();
            if (a.x < b.x+4 || a.x+a.width > b.x+b.width-4 || a.y+a.height>b.y+b.height-3)
              failures.push('node text: ' + n.dataset.node + ' / ' + t.textContent);
          }
          for (let i=0;i<body.length;i++) for(let j=i+1;j<body.length;j++)
            if(overlap(body[i].getBBox(),body[j].getBBox())) failures.push('node text overlap: '+n.dataset.node);
        }
        const labels = [...svg.querySelectorAll('.edge-label')];
        for(const label of labels) {
          const b=label.getBBox();
          for(const n of nodes) if(overlap(b,n.querySelector('rect').getBBox())) failures.push('edge label over node: '+label.textContent);
        }
        for(let i=0;i<labels.length;i++) for(let j=i+1;j<labels.length;j++)
          if(overlap(labels[i].getBBox(),labels[j].getBBox())) failures.push('edge label overlap: '+labels[i].textContent);
        return [...new Set(failures)];
      });
      if (issues.length) throw new Error(figure.id + ': ' + issues.join(' / '));
      await page.locator('svg').screenshot({ path: path.join(dir, figure.id + '.png') });
      report.push({ id: figure.id, textClipping: 0, nodeTextOverlap: 0, labelOverlap: 0 });
      process.stdout.write(figure.id + ' geometry passed; PNG saved\n');
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    const errors=[];
    page.on('pageerror', e=>errors.push(e.message));
    await page.goto(pathToFileURL(path.join(dir, 'index.html')).href);
    for (const figure of all) {
      const main=figure.id.split('-')[0];
      await page.locator('nav button[data-id="' + main + '"]').click();
      if(figure.id!==main) await page.locator('#detail').selectOption(figure.id);
      const canvas=page.locator('.sheet[data-sheet="'+figure.id+'"]');
      if(!await canvas.isVisible()) throw new Error('Viewer sheet missing: '+figure.id);
      if(await page.locator('#svg-link').getAttribute('href')!==figure.id+'.svg') throw new Error('Wrong download: '+figure.id);
      const node=canvas.locator('.node').first();
      if(await node.count()) {
        await node.dispatchEvent('click');
        if(!await node.evaluate(n=>n.classList.contains('selected'))) throw new Error('Highlight failed: '+figure.id);
        await page.locator('#reset').click();
      }
    }
    await page.locator('nav button[data-id="F09"]').click();
    await page.locator('#actual').click();
    if(await page.locator('#level').textContent()!=='100%') throw new Error('Actual-size zoom failed');
    await page.locator('#plus').click();
    await page.locator('#fit').click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('nav button[data-id="F01"]').click();
    if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)) throw new Error('Mobile page overflow');
    if(errors.length) throw new Error('Gallery JS: '+errors.join(' / '));
    fs.writeFileSync(path.join(dir,'render-report.json'),JSON.stringify({sheets:report,viewer:{desktop:true,mobile:true,zoom:true,highlight:true,detailNavigation:true}},null,2)+'\n');
    process.stdout.write('Gallery: 27 sheets, detail navigation, highlight, zoom, desktop/mobile passed\n');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
