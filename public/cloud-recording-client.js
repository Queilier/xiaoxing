(() => {
  // The same-origin formal activity shares the host's recorder and upload queue.
  // Keep the host document alive so MediaRecorder does not stop during handoff.
  if (window.parent !== window) {
    try {
      if (window.parent.location.origin === location.origin && window.parent.XiaoxingRecording) {
        window.fetch = (input, options) => window.parent.XiaoxingRecording.fetch(input, options);
        return;
      }
    } catch { /* Standalone embedded pages retain their own controls. */ }
  }
  const originalFetch = window.fetch.bind(window);
  let token = sessionStorage.getItem('cloud-recording-token'), active = false, recorder, stream, timer, flushing = false, finalizing = false, pending = 0, writes = Promise.resolve();
  const dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open('xiaoxing-recording-queue', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('uploads', { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  });
  async function transaction(mode, run) {
    const db = await dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('uploads', mode); const request = run(tx.objectStore('uploads'));
      tx.oncomplete = () => resolve(request.result); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    });
  }
  const panel = document.createElement('section');
  panel.style.cssText = 'padding:16px;margin:12px;border:1px solid #ccd;border-radius:12px;background:white;color:#263238;font:14px sans-serif';
  panel.innerHTML = '<p>经家长同意后，将记录现场声音、语音输入、转写文字和 AI 回复，先暂存于本机，点击停止后整份上传至研究者的私有云端存储。停止记录后将不再收集。请保持本页打开；切换页面或锁屏可能中断录音。关闭网页前请等待上传完成。</p><label>家庭/被试编号 <input aria-label="记录家庭编号" maxlength="80"></label> <button type="button">同意并开始记录</button> <button type="button" disabled>停止记录</button><p role="status"></p>';
  document.body.prepend(panel);
  const [start, stop] = panel.querySelectorAll('button'); const status = panel.querySelector('[role=status]');
  const say = text => status.textContent = text;
  async function flush() {
    if (flushing || active || finalizing || !sessionStorage.getItem('recording-upload-ready')) return;
    flushing = true;
    try {
      const rows = await transaction('readonly', s => s.getAll());
      const groups = new Map();
      for (const row of rows) { if (!groups.has(row.token)) groups.set(row.token, []); groups.get(row.token).push(row); }
      for (const [sessionToken, group] of groups) {
        const events = [], files = [], ambient = [];
        for (const row of group) {
          if (row.ext === 'json') events.push(JSON.parse(await row.body.text()));
          else if (row.ambient) ambient.push(row);
          else files.push({ name: row.id + '.' + row.ext, body: row.body });
        }
        events.sort((a,b) => a.at.localeCompare(b.at));
        ambient.sort((a,b) => a.sequence - b.sequence);
        const fullAudio = ambient.length ? 'recording.' + ambient[0].ext : null;
        if (fullAudio) files.push({ name: fullAudio, body: new Blob(ambient.map(r => r.body), { type: ambient[0].type }) });
        files.push({ name: 'records.json', body: new Blob([JSON.stringify({ participant: events[0]?.participant, audio: fullAudio, events }, null, 2)]) });
        const archive = await window.makeRecordingZip(files);
        if (archive.size > 49 * 1024 * 1024) throw new Error('本次记录超过 49MB，请联系研究者调整存储容量；数据仍在本机');
        say('录制已停止，正在上传整份记录，请勿关闭页面…');
        const response = await originalFetch('/api/recording/upload', { method: 'POST', headers: { 'Content-Type': 'application/zip', 'X-Recording-Session': sessionToken, 'X-Recording-File': sessionToken.split('.')[0] + '.zip' }, body: archive, signal: AbortSignal.timeout(180000) });
        if (!response.ok) throw new Error('整份记录上传失败，将自动重试');
        for (const row of group) await transaction('readwrite', store => store.delete(row.id));
      }
      say(active ? '正在记录；当前记录已上传' : '当前待上传记录已全部保存');
    } catch (error) { say(error.message + '。请保持本页打开。'); }
    finally { flushing = false; }
  }
  async function queue(body, type, ext, sessionToken = token, extra = {}) {
    try {
      const id = crypto.randomUUID();
      writes = writes.then(() => transaction('readwrite', s => s.put({ id, token: sessionToken, body, type, ext, ...extra })));
      await writes;
      void flush();
      return id + '.' + ext;
    } catch { say('本地暂存失败，请停止记录并检查设备存储空间。'); stop.click(); }
  }
  const event = (data, sessionToken = token) => queue(new Blob([JSON.stringify({ ...data, at: new Date().toISOString(), page: location.pathname, participant: panel.querySelector('input').value })]), 'application/json', 'json', sessionToken);
  window.fetch = async function(input, options = {}) {
    const path = new URL(typeof input === 'string' ? input : input.url, location.href).pathname;
    const capture = active && ['/api/chat', '/api/warmup', '/api/transcribe', '/api/tts'].includes(path);
    const sessionToken = token, requestId = crypto.randomUUID();
    if (capture) pending++;
    if (capture) {
      if (Object.prototype.toString.call(options.body) === '[object Blob]') {
        const mime = options.body.type.split(';')[0];
        const ext = ({ 'audio/mp4': 'mp4', 'audio/mpeg': 'mp3', 'audio/wav': 'wav' })[mime] || 'webm';
        const file = await queue(options.body, mime, ext, sessionToken);
        await event({ kind: 'voice_input', requestId, path, file }, sessionToken);
      } else await event({ kind: 'request', requestId, path, body: options.body }, sessionToken);
    }
    try {
      const response = await originalFetch(input, options);
      if (capture) {
        const copy = response.clone();
        if (copy.headers.get('Content-Type')?.startsWith('audio/')) {
          const file = await queue(await copy.blob(), 'audio/mpeg', 'mp3', sessionToken);
          await event({ kind: 'ai_audio_generated', requestId, path, file }, sessionToken);
        } else await event({ kind: 'response', requestId, path, status: response.status, body: await copy.text() }, sessionToken);
      }
      return response;
    } catch (error) { if (capture) await event({ kind: 'request_error', requestId, path, message: error.message }, sessionToken); throw error; } finally { if (capture) pending--; }
  };
  window.XiaoxingRecording = {
    fetch: (...args) => window.fetch(...args),
    openActivity() {
      if (document.getElementById('formal-activity-frame')) return;
      void event({ kind: 'formal_activity_open' });
      document.querySelector('main')?.setAttribute('hidden', '');
      const frame = document.createElement('iframe');
      frame.id = 'formal-activity-frame';
      frame.title = '正式科学探索活动';
      frame.allow = 'microphone; autoplay; fullscreen';
      frame.style.cssText = 'display:block;width:100%;height:100vh;border:0';
      frame.src = '/activity';
      panel.after(frame);
      panel.querySelector('p').textContent = '热身与正式活动共用本次记录。录制继续进行，无需再次填写编号或开始。全部活动结束后点击“停止记录”，并等待上传完成。';
      window.scrollTo(0, 0);
    }
  };
  start.onclick = async () => {
    start.disabled = true;
    sessionStorage.removeItem('recording-upload-ready');
    try {
      if (!panel.querySelector('input').value.trim()) throw new Error('请先填写家庭/被试编号');
      const config = await (await originalFetch('/api/recording/config')).json();
      if (!config.enabled) throw new Error('云端存储尚未配置，请联系研究者');
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false } });
      const response = await originalFetch('/api/recording/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ consent: true }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      token = data.token; sessionStorage.setItem('cloud-recording-token', token); active = true; stop.disabled = false;
      panel.querySelector('input').disabled = true;
      await event({ kind: 'recording_start' });
      const mimeType = ['audio/webm;codecs=opus', 'audio/mp4'].find(t => MediaRecorder.isTypeSupported(t));
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      let sequence = 0;
      recorder.ondataavailable = e => { if (e.data.size) void queue(e.data, recorder.mimeType, recorder.mimeType.includes('mp4') ? 'mp4' : 'webm', token, { ambient: true, sequence: sequence++ }); };
      recorder.onstop = async () => {
        stream?.getTracks().forEach(t => t.stop());
        await event({ kind: 'recording_stop' });
        while (pending) await new Promise(resolve => setTimeout(resolve, 100));
        await writes;
        finalizing = false;
        sessionStorage.setItem('recording-upload-ready', 'true');
        await flush();
        start.disabled = false; panel.querySelector('input').disabled = false;
      };
      recorder.onerror = () => { say('现场录音中断，正在整理已记录内容'); stop.click(); };
      recorder.start(10000);
      say('正在录制，数据暂存在本机；点击停止后统一上传');
    } catch (error) { active = false; stream?.getTracks().forEach(t => t.stop()); start.disabled = false; stop.disabled = true; panel.querySelector('input').disabled = false; say(error.message); }
  };
  stop.onclick = () => {
    if (!active) return;
    finalizing = true; active = false; stop.disabled = true;
    say('已停止，正在整理完整录音和对话…');
    if (recorder?.state === 'recording') recorder.stop();
  };
  window.addEventListener('beforeunload', e => { if (active || finalizing || flushing) { e.preventDefault(); e.returnValue = ''; } });
  window.addEventListener('online', flush); setInterval(flush, 15000); /* Pending interrupted sessions upload only after an explicit stop. */
  document.addEventListener('visibilitychange', () => { if (active) void event({ kind: 'visibility', state: document.visibilityState }); });
})();
