(() => {
  if (window.parent !== window) {
    try {
      if (window.parent.location.origin === location.origin && window.parent.XiaoxingRecording) {
        const host = window.parent.XiaoxingRecording;
        window.fetch = (input, options) => host.fetch(input, options, location.pathname);
        window.XiaoxingRecording = { openActivity: () => host.openActivity() };
        if (location.pathname === '/activity') {
          const participant = document.getElementById('participantId');
          if (participant) { participant.value = host.participant(); participant.readOnly = true; participant.closest('.participant-area').hidden = true; }
          const download = document.getElementById('downloadDataBtn'); if (download) download.hidden = true;
          const finish = document.createElement('button'); finish.type = 'button'; finish.textContent = '结束今天的互动';
          finish.style.cssText = 'display:block;margin:28px auto;padding:16px 30px;background:#dff3df;font-size:20px;border:0;border-radius:20px;cursor:pointer';
          finish.onclick = () => host.finish(); document.body.append(finish);
          const status = document.getElementById('status'); if (status) status.textContent = '家庭 ID 已填写，点击“开始探索”开始正式互动。';
        }
        return;
      }
    } catch {}
  }
  const guided = location.pathname === '/' || location.pathname === '/guidance.html';
  const nativeFetch = window.fetch.bind(window);
  let current = null, active = false, finishing = false, uploading = false, pending = 0, writes = Promise.resolve();
  const db = new Promise((resolve, reject) => {
    const request = indexedDB.open('xiaoxing-conversation-json', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('sessions', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  async function store(mode, action) {
    const database = await db;
    return new Promise((resolve, reject) => {
      const tx = database.transaction('sessions', mode), request = action(tx.objectStore('sessions'));
      tx.oncomplete = () => resolve(request.result); tx.onerror = tx.onabort = () => reject(tx.error);
    });
  }
  const panel = document.createElement('section');
  panel.style.cssText = 'padding:16px;margin:12px;border:1px solid #ccd;border-radius:12px;background:white;color:#263238;font:14px sans-serif';
  panel.innerHTML = '<p>经家长同意后，记录热身及正式活动的文字输入、语音转写、AI 回复和时间。活动结束点击“结束并保存记录”，整份 JSON 自动上传到研究者的私有云端。本功能不保存录音或 AI 音频。请等待上传完成后再关闭页面。</p><label>家庭/被试编号 <input aria-label="记录家庭编号" maxlength="80"></label> <button type="button">同意并开始记录</button> <button type="button" disabled>结束并保存记录</button><p role="status"></p>';
  document.body.prepend(panel);
  const [start, stop] = panel.querySelectorAll('button'), input = panel.querySelector('input'), status = panel.querySelector('[role=status]');
  if (guided) {
    panel.style.cssText += ';max-width:860px;margin:16px auto 40px';
    panel.querySelector('p').hidden = true;
    panel.querySelector('label').firstChild.textContent = '家庭 ID ';
    start.textContent = '同意并进入热身 →'; stop.hidden = true;
    document.getElementById('guidance').after(panel);
  }
  function showThanks() {
    if (!guided) return;
    document.getElementById('formal-activity-frame')?.remove();
    document.getElementById('guidance').hidden = true;
    panel.hidden = true;
    let thanks = document.getElementById('thanks');
    if (!thanks) {
      thanks = document.createElement('main'); thanks.id = 'thanks';
      thanks.style.textAlign = 'center';
      thanks.innerHTML = '<h1>今天的亲子互动到这里结束了，感谢孩子和家长的参与！</h1><p>可以结束录音了。</p>';
      document.body.append(thanks);
    }
    window.scrollTo(0, 0);
  }
  const say = text => { status.textContent = text; };
  function persist() {
    const snapshot = structuredClone(current);
    writes = writes.catch(() => {}).then(() => store('readwrite', s => s.put(snapshot)));
    return writes;
  }
  async function record(data) {
    if (!current) return;
    current.document.events.push({ ...data, at: new Date().toISOString() });
    try { await persist(); } catch { say('本地保存失败，请勿关闭页面，请检查设备存储空间。'); }
  }
  async function flush() {
    if (active || finishing || uploading) return;
    uploading = true;
    try {
      const rows = await store('readonly', s => s.getAll());
      for (const row of rows.filter(r => r.ready)) {
        say('正在上传完整 JSON，请勿关闭页面…');
        const response = await nativeFetch('/api/recording/upload', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Recording-Session': row.token, 'X-Recording-File': row.id + '.json' }, body: JSON.stringify(row.document, null, 2), signal: AbortSignal.timeout(60000) });
        if (!response.ok) throw new Error('云端上传失败');
        await store('readwrite', s => s.delete(row.id));
      }
      if (rows.some(r => r.ready)) { say('完整 JSON 已保存到云端，可以关闭页面。'); showThanks(); }
    } catch { say('JSON 尚未上传完成，已保留在本机，将自动重试。请保持页面打开。'); }
    finally { uploading = false; }
  }
  async function captureFetch(resource, options = {}, page = location.pathname) {
    const path = new URL(typeof resource === 'string' ? resource : resource.url, location.href).pathname;
    const capture = active && ['/api/chat', '/api/warmup', '/api/transcribe', '/api/tts'].includes(path);
    const requestId = crypto.randomUUID();
    if (capture) pending++;
    try {
      if (capture) {
        let body = null;
        if (typeof options.body === 'string') { try { body = JSON.parse(options.body); } catch { body = options.body; } }
        await record({ kind: 'request', requestId, path, page, body, inputType: path === '/api/transcribe' ? 'voice' : 'text_or_control' });
      }
      const response = await nativeFetch(resource, options);
      if (capture) {
        if (response.headers.get('Content-Type')?.startsWith('audio/')) {
          await record({ kind: 'ai_audio_generated', requestId, page, status: response.status, audioSaved: false });
        } else {
          const text = await response.clone().text(); let body;
          try { body = JSON.parse(text); } catch { body = text; }
          await record({ kind: 'response', requestId, path, page, status: response.status, body });
        }
      }
      return response;
    } catch (error) {
      if (capture) await record({ kind: 'request_error', requestId, path, page, message: error.message });
      throw error;
    } finally { if (capture) pending--; }
  }
  window.fetch = captureFetch;
  window.XiaoxingRecording = {
    fetch: captureFetch,
    participant: () => current?.document.participant || '',
    finish: () => stop.click(),
    openActivity() {
      if (active) void record({ kind: 'formal_activity_open', page: '/activity' });
      showFrame('/activity');
    }
  };
  function showFrame(path) {
    document.querySelector('main')?.setAttribute('hidden', '');
    panel.hidden = true;
    let frame = document.getElementById('formal-activity-frame');
    if (!frame) {
      frame = document.createElement('iframe'); frame.id = 'formal-activity-frame';
      frame.allow = 'microphone; autoplay; fullscreen';
      frame.style.cssText = 'display:block;width:100%;height:100vh;border:0'; panel.after(frame);
    }
    frame.title = path === '/activity' ? '正式科学探索活动' : '热身练习';
    frame.src = path; window.scrollTo(0, 0);
  }

  start.onclick = async () => {
    start.disabled = true;
    try {
      if (!input.value.trim()) throw new Error('请先填写家庭/被试编号');
      const response = await nativeFetch('/api/recording/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ consent: true }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || '无法开始记录');
      current = { id: data.token.split('.')[0], token: data.token, ready: false, document: { schemaVersion: 2, participant: input.value.trim(), consentAt: new Date().toISOString(), startedAt: new Date().toISOString(), endedAt: null, audioSaved: false, events: [] } };
      await persist();
      if (guided) { sessionStorage.removeItem('xiaoxing-warmup-v1'); sessionStorage.removeItem('xiaoxing-warmup-handoff'); }
      active = true; input.disabled = true; stop.disabled = false;
      await record({ kind: 'session_start', page: location.pathname }); say('正在记录文字对话；热身与正式活动共用一份 JSON。');
      if (guided) showFrame('/warmup');
    } catch (error) { start.disabled = false; say(error.message); }
  };
  stop.onclick = async () => {
    if (!active) return;
    active = false; finishing = true; stop.disabled = true;
    if (guided) { panel.hidden = false; input.hidden = true; start.hidden = true; stop.hidden = true; const frame = document.getElementById('formal-activity-frame'); if (frame) frame.style.display = 'none'; }
    say('正在等待已发送的 AI 请求完成，并整理完整 JSON…');
    try {
      while (pending) await new Promise(resolve => setTimeout(resolve, 100));
      const activity = document.getElementById('formal-activity-frame')?.contentWindow || window;
      current.document.experimentData = activity.experimentData ? structuredClone(activity.experimentData) : null;
      try { current.document.warmup = JSON.parse(sessionStorage.getItem('xiaoxing-warmup-v1') || 'null'); } catch {}
      current.document.endedAt = new Date().toISOString(); current.ready = true;
      await record({ kind: 'session_end', page: activity.location.pathname }); await writes;
      finishing = false; await flush(); start.disabled = false; input.disabled = false;
    } catch { finishing = false; active = true; stop.disabled = false; stop.hidden = false; say('整理失败，请再次点击结束保存；请勿关闭页面。'); }
  };
  async function restore() {
    try {
      const rows = await store('readonly', s => s.getAll());
      const drafts = rows.filter(row => !row.ready);
      if (drafts.length) {
        current = drafts.at(-1); active = true; start.disabled = true; stop.disabled = false; input.disabled = true; input.value = current.document.participant;
        say('已恢复本机未结束的文字记录，可继续活动或点击结束保存。');
        if (guided) showFrame(current.document.events.some(e => e.kind === 'formal_activity_open') ? '/activity' : '/warmup');
      } else await flush();
    } catch { say('无法打开本地存储，请检查浏览器设置。'); }
  }
  window.addEventListener('online', flush); setInterval(flush, 15000); void restore();
  window.addEventListener('beforeunload', e => { if (active || finishing || uploading) { e.preventDefault(); e.returnValue = ''; } });
})();
