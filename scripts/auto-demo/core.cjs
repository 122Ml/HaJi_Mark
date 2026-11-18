const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { chromium } = require('playwright');
const { choose, selectFile } = require('../browser-ui.cjs');

const root = path.resolve(__dirname, '../..');
const folder = path.join(root, '.local/auto-demo');
const flows = require('./flows.json');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
class Stopped extends Error { constructor() { super('已停止后续操作；已提交的后台任务保留'); } }
function saveJSON(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(file + '.tmp', file);
}
function createState() {
  const id = new Date().toISOString().replace(/[:.]/g, '-');
  return { id, created_at: new Date().toISOString(), course_title: `数据库系统原理 · ${id.slice(0, 10)} ${id.slice(11, 19).replaceAll('-', ':')}`, objects: {}, steps: {}, flows: {} };
}
class Demo {
  constructor(options = {}) {
    this.options = options;
    this.base = options.base || 'http://127.0.0.1:18080';
    const url = new URL(this.base);
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw Error('自动演示仅支持本机服务');
    fs.mkdirSync(folder, { recursive: true });
    this.state = fs.existsSync(path.join(folder, 'state.json')) ? JSON.parse(fs.readFileSync(path.join(folder, 'state.json'), 'utf8')) : createState();
    this.pages = {}; this.contexts = {}; this.paused = false; this.stopped = false; this.busy = false;
    this.emit = options.emit || (value => process.stdout.write(JSON.stringify(value) + '\n'));
    this.save();
  }
  save() {
    saveJSON(path.join(folder, 'state.json'), this.state);
    saveJSON(path.join(folder, this.state.id, 'state.json'), this.state);
  }
  event(type, values = {}) {
    const event = { type, at: new Date().toISOString(), ...values };
    fs.appendFileSync(path.join(folder, this.state.id, 'events.jsonl'), JSON.stringify(event) + '\n');
    this.emit(type === 'receipt' ? { ...event, result: Array.isArray(values.result) ? values.result.map(r => ({ id: r.id, kind: r.kind, state: r.state })) : values.result ? { id: values.result.id, state: values.result.state } : null } : event);
  }
  snapshot() { return { id: this.state.id, course: this.state.course_title, course_id: this.state.objects.course_id, flows: this.state.flows, busy: this.busy, paused: this.paused }; }
  object(key, value) { this.state.objects[key] = value; this.save(); return value; }
  get objects() { return this.state.objects; }
  async gate() {
    while (this.paused && !this.stopped) await delay(150);
    if (this.stopped) throw new Stopped();
  }
  async step(label, fn) {
    await this.gate();
    this.event('step', { flow: this.current, label });
    if (!this.options.headless) await delay(this.options.pace ?? 650);
    const result = await fn();
    await this.gate();
    return result;
  }
  async boot() {
    if (this.browser?.isConnected()) return;
    this.browser = await chromium.launch({ channel: 'msedge', headless: !!this.options.headless, slowMo: this.options.headless ? 0 : 120, args: ['--start-maximized'] });
    for (const role of ['teacher', 'student']) {
      const context = await this.browser.newContext({ viewport: this.options.headless ? { width: 1440, height: 1000 } : null, acceptDownloads: true });
      const page = await context.newPage(); page.setDefaultTimeout(20000);
      page.on('dialog', d => { if (d.type() === 'beforeunload') void d.accept(); else void d.dismiss(); });
      page.on('pageerror', e => this.event('browser_error', { role, message: e.message }));
      this.contexts[role] = context; this.pages[role] = page;
      await page.goto(this.base + '/login');
      await page.getByLabel('用户名', { exact: true }).fill(role === 'teacher' ? 'te' : 'st');
      await page.getByLabel('密码', { exact: true }).fill(role === 'teacher' ? 'te123' : 'st123');
      await page.getByRole('button', { name: '登录', exact: true }).click();
      await page.waitForURL(u => u.pathname.startsWith('/' + role + '/'));
    }
    this.event('browser', { label: '教师与学生独立会话已就绪' });
  }
  async go(role, route, extra = '') {
    await this.gate();
    this.role = role; const p = this.pages[role]; await p.bringToFront();
    const query = new URLSearchParams(extra);
    if (this.objects.course_id) query.set('course', this.objects.course_id);
    await p.goto(`${this.base}/${role}/${route}?${query}`);
    return p;
  }
  async read(url, role = 'teacher') {
    const response = await this.contexts[role].request.get(this.base + '/api/v1' + url);
    if (!response.ok()) throw Error(`读取失败 ${response.status()} ${url}: ${(await response.text()).slice(0, 400)}`);
    const value = await response.json(); return value.data;
  }
  async api(suffix = '', role = 'teacher') { return this.read('/learning/courses/' + this.objects.course_id + suffix, role); }
  async mutate(key, page, suffix, action, method = 'POST') {
    await this.gate();
    const saved = this.state.steps[key];
    if (saved?.state === 'done') return saved.result;
    if (saved?.state === 'unknown' || (saved?.state === 'pending' && saved.sent)) throw Error(`操作 ${key} 的写入结果待核对，请检查回执后继续，禁止自动重发`);
    const state = { state: 'pending', started_at: new Date().toISOString(), method, suffix, sent: false };
    this.state.steps[key] = state; this.save();
    const predicate = r => r.request().method() === method && new URL(r.url()).pathname.endsWith(suffix);
    const sent = request => { if (request.method() === method && new URL(request.url()).pathname.endsWith(suffix)) { state.sent = true; this.save(); } };
    page.on('request', sent);
    // Persist the response as it arrives, even if stop is pressed during a model request.
    const capture = async response => {
      if (!predicate(response)) return;
      state.http_status = response.status();
      let value;
      try { value = await response.json(); }
      catch {
        state.state = response.ok() ? 'unknown' : 'rejected';
        state.error = '无法解析响应，请核对实际保存结果'; this.save(); return;
      }
      if (response.ok()) { state.state = 'done'; state.result = value.data; state.finished_at = new Date().toISOString(); }
      else { state.state = 'rejected'; state.error = JSON.stringify(value).slice(0, 1000); }
      this.save();
    };
    page.on('response', capture);
    const pending = page.waitForResponse(predicate, { timeout: 90000 }); pending.catch(() => {});
    try {
      await action(); const response = await pending; await capture(response);
      if (!response.ok() || state.state !== 'done') throw Error(`写入待核对 ${state.http_status}: ${state.error}`);
      this.event('receipt', { flow: this.current, label: key, result: state.result });
      return state.result;
    } catch (e) {
      if (state.state !== 'done') { state.state = state.sent && (!state.http_status || state.http_status < 300) ? 'unknown' : 'rejected'; state.error = e.message; this.save(); }
      if (state.state === 'done') return state.result;
      throw e;
    } finally { page.off('request', sent); page.off('response', capture); }
  }
  async wait(label, read, accept, stateOf = value => value.state, timeout = 240000) {
    const start = Date.now(); let previous;
    while (Date.now() - start < timeout) {
      if (this.stopped) throw new Stopped();
      const value = await read(); const state = stateOf(value);
      if (state !== previous) { this.event('waiting', { flow: this.current, label, state }); previous = state; }
      if (['failed', 'unknown', 'canceled'].includes(state)) throw Error(`${label} ${state}：${JSON.stringify(value.error || value.report?.job_error || value.runs?.[0]?.error || '')}`);
      if (accept(value)) return value;
      await delay(1000);
    }
    throw Error(`${label}仍未结束；保存原任务，后续只查该任务，不自动重新调用`);
  }
  async job(job) {
    if (!job?.id) throw Error('后台任务未返回ID');
    return this.wait('后台任务 ' + (job.kind || job.id), () => this.api('/jobs/' + job.id), value => value.state === 'succeeded');
  }
  async index(key) {
    if (this.state.steps[key]?.state === 'done') return this.job(this.state.steps[key].result);
    const p = await this.go('teacher', 'materials');
    await p.getByText('检索索引', { exact: true }).click();
    const job = await this.mutate(key, p, '/jobs', () => p.getByRole('button', { name: '更新检索索引', exact: true }).click());
    await this.job(job);
  }
  async budget() {
    if (!this.objects.course_id) return;
    const models = await this.api('/models');
    if (models.budget && models.budget.spent_micro_cny + models.budget.reserved_micro_cny >= models.budget.limit_micro_cny) throw Error('共享联调预算已达上限');
    this.state.budget = models.budget; this.save();
  }
  async database(tables) {
    const allowed = new Set(['courses','enrollments','knowledge_points','material_sources','material_fragments','resources','knowledge_entries','retrieval_chunks','chunk_embeddings','bank_question_versions','rubric_versions','assignments','questions','answer_drafts','submissions','grading_revisions','learning_events','learning_notes','study_paths','intelligence_reports','recommendation_choices','interventions','agent_runs','agent_steps','agent_requests','regrade_batches','regrade_items','interactions','research_records','industry_records','assist_turns']);
    const id = this.objects.course_id;
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw Error('非法课程ID');
    const counts = {};
    for (const table of tables) {
      if (!allowed.has(table)) throw Error('未授权的核对表');
      const through = {
        questions: `assignment_id IN (SELECT id FROM assignments WHERE course_id='${id}')`,
        answer_drafts: `question_id IN (SELECT q.id FROM questions q JOIN assignments a ON a.id=q.assignment_id WHERE a.course_id='${id}')`,
        grading_revisions: `submission_id IN (SELECT id FROM submissions WHERE course_id='${id}')`,
        learning_notes: `resource_id IN (SELECT id FROM resources WHERE course_id='${id}')`,
        material_fragments: `source_id IN (SELECT id FROM material_sources WHERE course_id='${id}')`,
        chunk_embeddings: `chunk_id IN (SELECT id FROM retrieval_chunks WHERE course_id='${id}')`,
        bank_question_versions: `bank_id IN (SELECT id FROM question_bank WHERE course_id='${id}')`,
        rubric_versions: `(question_id IN (SELECT q.id FROM questions q JOIN assignments a ON a.id=q.assignment_id WHERE a.course_id='${id}') OR bank_question_version_id IN (SELECT v.id FROM bank_question_versions v JOIN question_bank b ON b.id=v.bank_id WHERE b.course_id='${id}'))`,
        recommendation_choices: `report_id IN (SELECT id FROM intelligence_reports WHERE course_id='${id}')`,
        agent_runs: `conversation_id IN (SELECT id FROM agent_conversations WHERE course_id='${id}')`,
        agent_steps: `run_id IN (SELECT r.id FROM agent_runs r JOIN agent_conversations c ON c.id=r.conversation_id WHERE c.course_id='${id}')`,
        agent_requests: `run_id IN (SELECT r.id FROM agent_runs r JOIN agent_conversations c ON c.id=r.conversation_id WHERE c.course_id='${id}')`,
        regrade_items: `batch_id IN (SELECT id FROM regrade_batches WHERE course_id='${id}')`,
      };
      const where = table === 'courses' ? `id='${id}'` : through[table] || `course_id='${id}'`;
      const sql = `BEGIN READ ONLY; SELECT COUNT(*) FROM ${table} WHERE ${where}; COMMIT;\n`;
      const output = await new Promise((resolve, reject) => {
        const child = execFile('docker', ['compose','-f','compose.yaml','-f','compose.rag.yaml','exec','-T','postgres','sh','-c','exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -v ON_ERROR_STOP=1'], { cwd: root, timeout: 20000, windowsHide: true }, (e, stdout, stderr) => e ? reject(Error(stderr || e.message)) : resolve(stdout));
        child.stdin.end(sql);
      });
      const number = output.trim().split(/\r?\n/).find(line => /^\d+$/.test(line));
      if (number === undefined) throw Error('无法核对落库数量 ' + table);
      counts[table] = Number(number);
      if (counts[table] === 0) throw Error('当前课程未产生预期记录：' + table);
    }
    this.event('database', { flow: this.current, course_id: id, counts });
    return counts;
  }
  async execute(id) {
    const flow = flows.find(f => f.id === id); if (!flow) throw Error('未知流程 ' + id);
    for (const dependency of flow.requires) if (this.state.flows[dependency]?.state !== 'done') await this.execute(dependency);
    this.current = id;
    if (this.state.flows[id]?.state === 'done') { this.event('saved', { flow: id, label: '展示已保存结果' }); await require('./workflows.cjs').show(this, id); return; }
    this.state.flows[id] = { state: 'running', started_at: new Date().toISOString() }; this.save();
    this.event('flow', { flow: id, label: flow.title });
    try {
      await this.budget();
      const counts = await require('./workflows.cjs')[id](this);
      const screenshot = path.join(folder, this.state.id, id + '.png');
      await this.pages[this.role || 'teacher'].screenshot({ path: screenshot, fullPage: true });
      const receipt = { state: 'done', finished_at: new Date().toISOString(), counts, screenshot };
      this.state.flows[id] = receipt; this.save();
      this.event('complete', { flow: id, label: flow.title, receipt, snapshot: this.snapshot() });
    } catch (error) {
      const screenshot = path.join(folder, this.state.id, id + '-interrupted.png');
      await this.pages[this.role || 'teacher']?.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
      this.state.flows[id] = { state: error instanceof Stopped ? 'stopped' : 'failed', error: error.message, screenshot }; this.save(); throw error;
    }
  }
  async run(id) {
    if (this.busy) throw Error('当前演示尚未结束');
    this.busy = true; this.stopped = false; this.paused = false;
    try { await this.boot(); if (id === 'all') for (const f of flows) await this.execute(f.id); else await this.execute(id); }
    finally { this.busy = false; this.current = null; this.event('idle', { snapshot: this.snapshot() }); }
  }
  control(command) {
    if (command === 'pause') { this.paused = true; this.event('paused', { label: '已暂停后续操作，可以手动接管浏览器；后台任务继续' }); }
    if (command === 'resume') { this.paused = false; this.event('resumed'); }
    if (command === 'stop') { this.stopped = true; this.paused = false; this.event('stopping', { label: '正在停止后续操作；已提交任务不会被撤销' }); }
  }
  async newRun() {
    if (this.busy) throw Error('演示进行中不能创建新批次');
    this.state = createState(); this.save(); this.event('ready', { snapshot: this.snapshot() });
  }
  async retryFailed(id) {
    if (this.busy) throw Error('当前演示尚未结束');
    await this.boot();
    for (const [key, step] of Object.entries(this.state.steps)) {
      if ((id !== 'all' && !key.startsWith(id + '.')) || !step.result?.kind) continue;
      const jobID = step.result.job_id || ('progress' in step.result ? step.result.id : null);
      if (!jobID) continue;
      const job = await this.api('/jobs/' + jobID);
      if (job.state !== 'failed') continue;
      if (!this.state.failed_attempts) this.state.failed_attempts = [];
      this.state.failed_attempts.push({ key, step, job, retained_at: new Date().toISOString() });
      this.state.steps[key] = { state: 'rejected', previous_job_id: job.id };
      this.event('retry_authorized', { flow: id, label: '保留失败任务，按当前输入显式重试', job_id: job.id });
    }
    this.save();
  }
  async close() { this.control('stop'); await this.browser?.close(); }
}
module.exports = { Demo, flows, root, folder, choose, selectFile, delay, Stopped, saveJSON };
