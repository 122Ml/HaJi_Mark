const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Demo, Stopped, flows, delay } = require('./core.cjs');

function isolated() {
  const demo = Object.create(Demo.prototype);
  Object.assign(demo, { state: { steps: {} }, paused: false, stopped: false, options: { headless: true }, events: [] });
  demo.save = () => {};
  demo.event = (type, data) => demo.events.push({ type, ...data });
  return demo;
}
function page() {
  const p = new EventEmitter();
  p.waitForResponse = predicate => new Promise(resolve => p.on('response', r => { if (predicate(r)) resolve(r); }));
  return p;
}
const request = { method: () => 'POST', url: () => 'http://127.0.0.1/api/v1/jobs' };
const response = { request: () => request, url: request.url, status: () => 200, ok: () => true, json: async () => ({ data: { id: 'saved-job' } }) };

test('each flow has unique identity and earlier, acyclic dependencies', () => {
  const seen = new Set();
  for (const f of flows) {
    assert(!seen.has(f.id));
    for (const dependency of f.requires) assert(seen.has(dependency));
    for (const key of ['title', 'input', 'process', 'output']) assert(f[key]);
    seen.add(f.id);
  }
});
test('pause prevents the next operation; resume releases it', async () => {
  const d = isolated(); let ran = false;
  d.control('pause');
  const operation = d.step('next', async () => { ran = true; });
  await delay(30); assert.equal(ran, false);
  d.control('resume'); await operation; assert.equal(ran, true);
});
test('stop prevents writes and interrupts a paused gate', async () => {
  const d = isolated(); let ran = false;
  d.control('pause');
  const operation = d.step('next', async () => { ran = true; });
  d.control('stop');
  await assert.rejects(operation, Stopped); assert.equal(ran, false);
});
test('successful response is persisted even when stop is requested in flight; replay never submits twice', async () => {
  const d = isolated(), p = page(); let calls = 0;
  const result = await d.mutate('write', p, '/jobs', async () => {
    calls++; p.emit('request', request); d.control('stop'); p.emit('response', response);
  });
  assert.equal(result.id, 'saved-job'); assert.equal(d.state.steps.write.state, 'done');
  d.stopped = false;
  await d.mutate('write', p, '/jobs', async () => { calls++; });
  assert.equal(calls, 1);
});
test('sent write with lost response is unknown and cannot replay', async () => {
  const d = isolated(), p = page(); let calls = 0;
  await assert.rejects(d.mutate('write', p, '/jobs', async () => {
    calls++; p.emit('request', request); throw Error('connection lost');
  }), /connection lost/);
  assert.equal(d.state.steps.write.state, 'unknown');
  await assert.rejects(d.mutate('write', p, '/jobs', async () => { calls++; }), /禁止自动重发/);
  assert.equal(calls, 1);
});
test('failure before request can resume without claiming a saved write', async () => {
  const d = isolated(), p = page();
  await assert.rejects(d.mutate('write', p, '/jobs', async () => { throw Error('button unavailable'); }), /button unavailable/);
  assert.equal(d.state.steps.write.state, 'rejected'); assert.equal(d.state.steps.write.sent, false);
});
test('successful HTTP with unreadable receipt is unknown, never a rejected safe retry', async () => {
  const d = isolated(), p = page();
  const unreadable = { ...response, json: async () => { throw Error('truncated body'); } };
  await assert.rejects(d.mutate('write', p, '/jobs', async () => {
    p.emit('request', request); p.emit('response', unreadable);
  }), /待核对/);
  assert.equal(d.state.steps.write.state, 'unknown');
});
