const readline = require('node:readline');
const fs = require('node:fs');
const path = require('node:path');
const { Demo, Stopped } = require('./core.cjs');
const options = { headless: process.argv.includes('--headless') };
const lock = path.resolve(__dirname, '../../.local/auto-demo/runner.lock');
fs.mkdirSync(path.dirname(lock), { recursive: true });
if (fs.existsSync(lock)) {
  const pid = Number(fs.readFileSync(lock, 'utf8'));
  let alive = false; try { process.kill(pid, 0); alive = true; } catch (e) { if (e.code !== 'ESRCH') alive = true; }
  if (alive) { process.stderr.write('已有演示进程，禁止并行写入同一批次\n'); process.exit(1); }
  fs.unlinkSync(lock);
}
fs.writeFileSync(lock, String(process.pid), { flag: 'wx' });
process.on('exit', () => { if (fs.existsSync(lock) && fs.readFileSync(lock, 'utf8') === String(process.pid)) fs.unlinkSync(lock); });
const demo = new Demo(options);
async function run(id, retryFailed = false) {
  try { if (retryFailed) await demo.retryFailed(id); await demo.run(id); return true; }
  catch (e) { demo.event(e instanceof Stopped ? 'stopped' : 'error', { message: e.message, snapshot: demo.snapshot() }); return false; }
}
(async () => {
  const index = process.argv.indexOf('--flow');
  if (index !== -1) {
    if (process.argv.includes('--new')) await demo.newRun();
    const ok = await run(process.argv[index + 1], process.argv.includes('--retry-failed')); await demo.close(); process.exitCode = ok ? 0 : 1; return;
  }
  demo.event('ready', { snapshot: demo.snapshot() });
  const input = readline.createInterface({ input: process.stdin });
  input.on('line', line => {
    (async () => {
      const message = JSON.parse(line);
      if (message.command === 'run') { void run(message.flow, message.retry_failed); return; }
      if (message.command === 'new') { await demo.newRun(); return; }
      if (message.command === 'show') { await demo.boot(); await demo.pages[demo.role || 'teacher'].bringToFront(); return; }
      if (message.command === 'shutdown') { await demo.close(); input.close(); return; }
      demo.control(message.command);
    })().catch(e => demo.event('error', { message: e.message }));
  });
  input.on('close', () => void demo.close());
})();
