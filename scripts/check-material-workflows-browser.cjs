// Real local UI acceptance. Model calls are reused, never mocked as AI success.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const base = 'http://127.0.0.1:18080';
const ids = JSON.parse(fs.readFileSync(path.join(root, '.local/material-workflows-check.json'), 'utf8'));
const accounts = JSON.parse(fs.readFileSync(path.join(root, '.local/s1-accounts.json'), 'utf8')).accounts;
const layoutOnly = process.argv.includes('--layout-only');
const out = path.join(root, layoutOnly ? '.local/material-workflows-layout.json' : '.local/material-workflows-browser.json');
const report = { actor: 'automated local browser, not independent teacher acceptance', checks: [], screenshots: [] };
const save = () => fs.writeFileSync(out, JSON.stringify(report, null, 2));
const assert = (ok, why) => { if (!ok) throw Error(why); };
const pass = why => { report.checks.push(why); save(); console.log('PASS', why); };
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const contexts = [], errors = [], failures = [];
  let teacher;
  try {
    async function login(username, role) {
      const c = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); contexts.push(c);
      const page = await c.newPage(); page.setDefaultTimeout(12000);
      page.on('pageerror', e => errors.push(e.message));
      page.on('response', r => { if (r.status() >= 500 && r.url().includes('/api/') && r.headers()['x-acceptance-injected'] !== '1') failures.push(r.status() + ' ' + new URL(r.url()).pathname); });
      page.on('dialog', d => d.accept());
      await page.goto(base + '/login');
      await page.getByLabel('用户名', { exact: true }).fill(username);
      await page.getByLabel('密码', { exact: true }).fill(accounts.find(a => a.username === username).password);
      await page.getByRole('button', { name: '登录', exact: true }).click();
      await page.waitForURL(u => u.pathname === `/${role}/${role === 'teacher' ? 'dashboard' : 'home'}`);
      const me = (await (await page.request.get(base + '/api/v1/me')).json()).data;
      const call = async (method, route, data, status = 200) => {
        const r = await page.request.fetch(base + '/api/v1/learning/courses/' + ids.course_id + route, { method, data, headers: { Origin: base, 'X-CSRF-Token': me.csrf_token } });
        assert(r.status() === status, `${method} ${route} ${r.status()} ${(await r.text()).slice(0, 300)}`);
        return r.headers()['content-type']?.includes('json') ? (await r.json()).data : await r.text();
      };
      return { page, call };
    }
    const { page: t, call: tc } = await login('s1-teacher', 'teacher'); teacher = t;
    const { page: s, call: sc } = await login('s1-student-a', 'student');
    const url = (role, route, args = {}) => `${base}/${role}/${route}?${new URLSearchParams({ course: ids.course_id, ...args })}`;
    const response = (method, suffix) => t.waitForResponse(r => r.request().method() === method && new URL(r.url()).pathname.endsWith(suffix));
    async function leave(route, args) { await t.goto(url('teacher', route, args)); }
    async function shot(name) {
      const file = '.local/material-' + name + '.png';
      await t.screenshot({ path: path.join(root, file), fullPage: true }); report.screenshots.push(file); save();
    }
    async function checkLayouts() {
      for (const width of [1440, 390]) {
        await t.setViewportSize({ width, height: 1000 });
        for (const [route, args] of [['materials', { source: ids.visual_source_id }], ['knowledge', {}], ['question-bank', { bank_version: ids.paper_versions[0].id }], ['regrades', { batch: ids.regrade_batch_id }]]) {
          await leave(route, args);
          if (route === 'materials') {
            const panel = t.getByRole('dialog', { name: '资料核对与发布', exact: true });
            await panel.locator('summary').filter({ hasText: /^公式与图像/ }).waitFor();
            assert(await panel.evaluate(e => e.scrollWidth <= e.clientWidth + 1), `drawer overflows at ${width}`);
          } else if (route === 'knowledge') {
            await t.locator('[id^="knowledge-"]').first().waitFor();
          } else if (route === 'question-bank') {
            await t.getByText('题图与原始来源', { exact: true }).waitFor();
          } else {
            await t.getByRole('heading', { name: '已统一发布 · 2/2', exact: true }).waitFor();
          }
          await t.evaluate(() => document.fonts.ready);
          assert(await t.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${route} overflows at ${width}`);
          await shot(`${route}-${width}`);
        }
      }
      pass('loaded module content and drawers fit 1440px and 390px viewports');
    }
    if (layoutOnly) {
      await checkLayouts();
      assert(!errors.length, errors.join('\n')); assert(!failures.length, failures.join('\n'));
      return;
    }

    await leave('knowledge');
    const topic = (await tc('GET', '/topics')).topics[0];
    const topics = t.locator('details').filter({ has: t.locator('summary').filter({ hasText: /^专题管理$/ }) }).first();
    await topics.locator('summary').first().click();
    await topics.getByRole('button', { name: topic.title + (topic.active ? '' : ' · 已停用'), exact: true }).click();
    for (const name of topic.active ? ['停用', '恢复'] : ['恢复', '停用']) {
      const [changed] = await Promise.all([response('PUT', '/topics/' + topic.id), topics.getByRole('button', { name, exact: true }).click()]);
      assert(changed.ok(), 'topic toggle failed with an obsolete edit version');
    }
    const restored = (await tc('GET', '/topics')).topics.find(v => v.id === topic.id);
    assert(restored.active === topic.active && restored.edit_version === topic.edit_version + 2, 'consecutive topic toggles did not persist');
    pass('topic can be disabled and restored consecutively without a stale editor version');

    await leave('materials', { source: ids.visual_source_id });
    const drawer = t.getByRole('dialog', { name: '资料核对与发布', exact: true });
    const visuals = drawer.locator('details').filter({ has: t.locator('summary').filter({ hasText: /^公式与图像/ }) }).first();
    await visuals.locator('summary').first().click();
    const formula = ids.visual_cases.find(v => v.fixture === 'formula');
    const assetData = await tc('GET', '/sources/' + ids.visual_source_id + '/assets');
    const assetIndex = assetData.assets.findIndex(a => a.id === formula.asset_id);
    await visuals.locator('.ant-select-selector').first().click();
    await t.locator('.ant-select-item-option').filter({ hasText: new RegExp('^' + (assetIndex + 1) + ' ·') }).click();
    assert(await visuals.locator('img').first().evaluate(i => i.complete && i.naturalWidth > 0), 'source image failed');
    await visuals.getByRole('button', { name: '载入候选', exact: true }).click();
    const text = visuals.getByLabel('图像核对转写', { exact: true });
    await t.waitForFunction(() => document.querySelector('[aria-label="图像核对转写"]')?.value.includes('mc'));
    const adopted = await text.inputValue();
    assert((await visuals.locator('.katex').count()) > 0, 'formula candidate not rendered');
    await text.fill(adopted + '\n浏览器核对：保持原公式及单位。');
    let injected = false;
    await t.route('**/assets/*/revisions', route => {
      if (route.request().method() === 'POST' && !injected) {
        injected = true;
        return route.fulfill({ status: 503, headers: { 'X-Acceptance-Injected': '1' }, contentType: 'application/json', body: JSON.stringify({ error: { code: 'test_failure', message: '验收注入：保存暂时失败' } }) });
      }
      return route.continue();
    });
    await visuals.getByRole('button', { name: '确认转写并更新原文', exact: true }).click();
    await visuals.getByText('验收注入：保存暂时失败', { exact: true }).waitFor();
    await t.reload();
    await visuals.locator('summary').first().click();
    await visuals.locator('.ant-select-selector').first().click();
    await t.locator('.ant-select-item-option').filter({ hasText: new RegExp('^' + (assetIndex + 1) + ' ·') }).click();
    assert((await text.inputValue()).endsWith('浏览器核对：保持原公式及单位。'), 'failed edit was lost after refresh');
    const [saved] = await Promise.all([response('POST', `/assets/${formula.asset_id}/revisions`), visuals.getByRole('button', { name: '确认转写并更新原文', exact: true }).click()]);
    assert(saved.ok(), 'visual retry failed');
    await visuals.getByText('已保存', { exact: true }).waitFor();
    const before = (await saved.json()).data;
    const detail = await tc('GET', '/sources/' + ids.visual_source_id);
    assert(detail.fragments.some(f => f.locator.asset_revision_id === before.id), 'new source revision missing');
    await shot('formula-editor');
    pass('real visual candidate loads, KaTeX renders, failed save survives refresh, confirmation creates a source revision');

    await leave('materials', { source: ids.sources['retrieval.txt'].source.id });
    const suggest = drawer.locator('details').filter({ has: t.locator('summary').filter({ hasText: /^目录与归类建议/ }) }).first();
    await suggest.locator('summary').first().click();
    await suggest.getByRole('button', { name: '载入候选', exact: true }).click();
    await suggest.getByRole('button', { name: '采纳所选建议', exact: true }).click();
    await suggest.getByText('已保存', { exact: true }).waitFor();
    pass('stored real classification candidate can be reviewed and adopted in the UI');

    const cmp = ids.jobs[ids.compare_job_id];
    await leave('knowledge', { knowledge: cmp.input.knowledge_id });
    const card = t.locator(`#knowledge-${cmp.input.knowledge_id}`);
    await card.getByRole('button', { name: '比较与处理', exact: true }).click();
    const review = t.getByRole('dialog', { name: '知识比较与决策', exact: true });
    await review.getByRole('button', { name: '载入候选', exact: true }).click();
    assert(await review.locator('blockquote').count() >= 2, 'missing two-sided comparison evidence');
    await review.getByLabel('处理理由', { exact: true }).fill('浏览器验证过期比较不得覆盖后续教师编辑');
    await review.getByRole('button', { name: '保存决定', exact: true }).click();
    await review.getByRole('alert').filter({ hasText: /版本不符|已变化/ }).waitFor();
    await shot('comparison');
    pass('comparison shows both exact quotations and rejects an obsolete candidate without closing the editor');

    await leave('question-bank', { paper_source: ids.sources['paper.pdf'].source.id });
    const paper = t.getByRole('dialog', { name: '整卷导入', exact: true }).locator('details').filter({ has: t.locator('summary').filter({ hasText: /^整卷拆题$/ }) }).first();
    await paper.locator('summary').first().click();
    await paper.getByRole('button', { name: '载入候选', exact: true }).click();
    await paper.getByLabel('题目', { exact: true }).waitFor();
    const count = await paper.getByLabel('题目', { exact: true }).locator('option').count();
    assert(count === 3, 'paper list lost question types');
    const prompt = paper.getByLabel('题干', { exact: true });
    const originalPrompt = await prompt.inputValue();
    await prompt.focus();
    await prompt.press('Control+Home');
    for (let i = 0; i < Math.floor(originalPrompt.length / 2); i++) await prompt.press('ArrowRight');
    await paper.getByRole('button', { name: '在光标位置拆题', exact: true }).click();
    assert(await paper.getByLabel('题目', { exact: true }).locator('option').count() === 4, 'split did not add question');
    await paper.getByRole('button', { name: '与下一题合并', exact: true }).click();
    assert((await prompt.inputValue()).replace(/\s/g, '') === originalPrompt.replace(/\s/g, ''), 'split/merge changed prompt');
    await paper.getByRole('button', { name: '下移', exact: true }).click();
    await paper.getByRole('button', { name: '上移', exact: true }).click();
    await t.reload();
    await paper.locator('summary').first().click();
    await paper.getByText('已恢复上次未保存的编辑。', { exact: true }).waitFor();
    await shot('paper-review');
    pass('real cross-page paper candidate supports split, merge, reorder and recovery without losing fragment coverage');

    await leave('question-bank');
    await t.getByLabel('搜索题目', { exact: true }).fill('分页构造');
    await t.getByText('1000 道题目', { exact: true }).waitFor();
    await t.getByLabel('筛选题型', { exact: true }).selectOption('code');
    await t.getByText('500 道题目', { exact: true }).waitFor();
    const first = await t.locator('.live-row h2').first().textContent();
    await t.locator('.ant-pagination-next button').click();
    await t.waitForFunction(first => document.querySelector('.live-row h2')?.textContent !== first, first);
    await shot('bank-paging');
    pass('1000-question bank filters on the server and changes visible records across pages');
    await leave('question-bank', { bank_version: ids.paper_versions[0].id });
    await t.getByText('题图与原始来源', { exact: true }).waitFor();
    await t.getByText('题图与原始来源', { exact: true }).click();
    await t.getByText('原卷拆题采纳', { exact: true }).waitFor();
    pass('bank version deep link exposes retained adoption provenance');

    await leave('content-impact');
    const change = t.locator('.live-row').filter({ hasText: 'new-version.txt' }).first();
    await change.getByRole('button', { name: '查看影响', exact: true }).click();
    await t.getByLabel('处理原因', { exact: true }).fill('浏览器核对后保留历史，下次选新版');
    await t.getByRole('button', { name: '保存处理决定', exact: true }).click();
    await t.getByText('已保存', { exact: true }).waitFor();
    await shot('impact');
    pass('content impact is navigable and a teacher decision persists');

    const bp = '/regrades/' + ids.regrade_batch_id;
    let batch = await tc('GET', bp);
    await leave('regrades', { batch: ids.regrade_batch_id });
    if (batch.batch.state === 'active') {
      assert(await t.getByRole('button', { name: '整组发布', exact: true }).isDisabled(), 'partial group was publishable');
      for (const [i, item] of batch.items.entries()) {
        await t.getByLabel('冻结名单', { exact: true }).selectOption(item.submission_id);
        await t.getByLabel('得分', { exact: true }).fill('7');
        await t.getByLabel('学生原文引用', { exact: true }).fill('拒绝超范围输入');
        await t.getByLabel('逐点反馈', { exact: true }).fill('按本批统一标准复核');
        await t.getByLabel('总反馈', { exact: true }).fill('浏览器整组重评结果7分');
        await t.getByRole('button', { name: '确认本份', exact: true }).click();
        await t.getByRole('heading', { name: `待复核 · ${i + 1}/2`, exact: true }).waitFor();
        if (i === 0) {
          assert(await t.getByRole('button', { name: '整组发布', exact: true }).isDisabled(), 'one confirmed student unlocked release');
          const old = await sc('GET', '/submissions/' + ids.regrade_submissions[0]);
          assert(old.revisions[0].score === 8, 'partial group leaked a new result');
        }
      }
      await t.getByRole('button', { name: '整组发布', exact: true }).click();
      await t.getByRole('heading', { name: '已统一发布 · 2/2', exact: true }).waitFor();
    }
    batch = await tc('GET', bp);
    assert(batch.batch.state === 'released', 'batch not released');
    for (const id of ids.regrade_submissions) {
      const sub = await tc('GET', '/submissions/' + id);
      assert(sub.revisions.filter(r => r.state === 'released')[0].score === 7, 'official result not replaced');
      assert(sub.revisions.some(r => r.score === 4) && sub.revisions.some(r => r.score === 8), 'old results lost');
    }
    await s.goto(url('student', 'homework/submissions/' + ids.regrade_submissions[0] + '/feedback'));
    await s.getByText('浏览器整组重评结果7分', { exact: true }).waitFor();
    await shot('regrade');
    pass('UI confirms each frozen submission, keeps old feedback until atomic release, and retains grading history');

    await leave('dashboard');
    const evidence = await tc('GET', '/evidence');
    const current = evidence.filter(e => ids.regrade_submissions.includes(e.submission_id));
    assert(current.length === 2 && current.every(e => e.score === 7), 'analytics counts old or duplicate grades');
    const downloadEvent = t.waitForEvent('download');
    await t.getByRole('button', { name: '导出当前正式结果', exact: true }).click();
    const download = await downloadEvent;
    const csvPath = path.join(root, '.local/material-official-results.csv');
    await download.saveAs(csvPath);
    const csv = fs.readFileSync(csvPath, 'utf8');
    assert(current.every(e => csv.includes(e.revision_id) && csv.includes(e.submission_id) && csv.includes('"7"')), 'CSV differs from official results');
    assert(!evidence.some(e => ids.regrade_submissions.includes(e.submission_id) && e.score !== 7), 'analytics uses obsolete score');
    pass('student feedback, deduplicated analytics and downloaded CSV share the released revisions');

    await s.goto(url('student', 'course-twin', { resource: ids.visual_resource_id }));
    await s.locator('.published-assets img').first().waitFor();
    assert(await s.locator('.published-assets img').first().evaluate(i => i.complete && i.naturalWidth > 0), 'student image failed');
    assert(await s.locator('.katex').count() > 0, 'student formula not rendered');
    await s.getByLabel('我的笔记', { exact: true }).fill('公式样例已核对；浏览器学习记录验收');
    await s.getByRole('button', { name: '保存笔记与收藏', exact: true }).click();
    await s.reload();
    assert((await s.getByLabel('我的笔记', { exact: true }).inputValue()).includes('公式样例已核对'), 'learning note lost');
    pass('student reads only the released visual resource, sees rendered math and retains a learning note');

    await checkLayouts();
    assert(!errors.length, errors.join('\n')); assert(!failures.length, failures.join('\n'));
    pass('no browser exceptions or unexpected API server errors');
  } catch (e) {
    report.error = e.message; report.url = teacher?.url();
    if (teacher) await teacher.screenshot({ path: path.join(root, '.local/material-browser-failure.png'), fullPage: true }).catch(() => {});
    throw e;
  } finally {
    report.browser_errors = errors; report.server_errors = failures; save();
    for (const c of contexts) await c.close();
    await browser.close();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
