import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const helper = fs.readFileSync(new URL('../public/data-export.js', import.meta.url), 'utf8');
function setup(saved, warmup, handoff = true) {
  const local = new Map(), session = new Map();
  if (warmup) session.set('xiaoxing-warmup-v1', JSON.stringify(warmup));
  if (handoff) session.set('xiaoxing-warmup-handoff', 'true');
  const context = { window: {}, console, STORAGE_KEY: 'formal', loadExperimentData: () => saved,
    localStorage: { setItem: (k,v) => local.set(k,v) },
    sessionStorage: { getItem: k => session.get(k), removeItem: k => session.delete(k) },
    saveExperimentData: () => { local.set('formal', JSON.stringify(context.window.experimentData)); return true; } };
  vm.createContext(context); vm.runInContext(helper, context);
  vm.runInContext(html.slice(html.indexOf('    let restoredExperimentData ='), html.indexOf('    // Record page load')), context);
  return { context, local, session };
}
const warmup = { startedAt: '2026-10-23T01:00:00Z', endedAt: '2026-10-23T01:02:00Z', history: [
  { role: 'user', text: '天空为什么是蓝的', speaker: 'host', via: 'voice', at: '2026-10-23T01:00:10Z' },
  { role: 'user', text: '小猫喜欢什么', speaker: 'child', via: 'text', at: '2026-10-23T01:01:10Z' }],
  pageEvents: [{ type: 'formal_start' }], errors: [{ source: 'tts', message: 'test error' }] };
test('热身交接持久保存，刷新恢复同一记录，普通访问不串入其他热身', () => {
  const first = setup(null, warmup);
  assert.equal(first.session.size, 0);
  const saved = JSON.parse(first.local.get('formal'));
  assert.deepEqual(saved.warmup.chatHistory, warmup.history);
  assert.equal(saved.warmup.startTime, warmup.startedAt);
  assert.equal(saved.warmup.endTime, warmup.endedAt);
  const reload = setup(saved, { history: [{ text: '其他热身' }] }, false);
  assert.deepEqual(reload.context.window.experimentData.warmup, saved.warmup);
  assert.equal(setup(null, warmup, false).context.window.experimentData.warmup, undefined);
});
test('实际下载按钮导出同一编号的热身和正式数据，保留旧字段', async () => {
  const p = setup(null, warmup), c = p.context;
  c.ensureExperimentDataShape = () => {};
  c.recordEvent = () => {};
  c.clearExperimentSession = () => { c.window.experimentData = { chatHistory: [] }; };
  vm.runInContext(html.slice(html.indexOf('    function ensureParticipantSession('), html.indexOf('    async function unlockAudio(')), c);
  vm.runInContext('ensureParticipantSession("001")', c);
  c.window.experimentData.chatHistory.push({ role: 'user', text: '正式提问' });
  let downloaded, filename;
  c.Blob = Blob;
  c.URL = { createObjectURL: blob => { downloaded = blob; return 'blob:export'; }, revokeObjectURL() {} };
  c.document = { createElement: () => ({ click() { filename = this.download; }, remove() {} }), body: { appendChild() {} } };
  const start = html.indexOf('    function downloadData()');
  vm.runInContext(html.slice(start, html.indexOf('\n    document', start)), c);
  vm.runInContext('downloadData()', c);
  const data = JSON.parse(await downloaded.text());
  assert.equal(filename, '001_science_exploration_data.json');
  assert.equal(data.childId, '001'); assert.equal(data.warmup.childId, '001');
  assert.deepEqual(data.warmup.chatHistory, warmup.history);
  assert.deepEqual(data.warmup.errors, warmup.errors);
  assert.deepEqual(data.warmup.pageEvents, warmup.pageEvents);
  assert.equal(data.chatHistory[0].text, '正式提问');
  assert.equal(data.schemaVersion, 2);
  vm.runInContext('ensureParticipantSession("002")', c);
  assert.equal(c.window.experimentData.warmup, undefined);
});
