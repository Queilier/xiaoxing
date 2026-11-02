(() => {
  const originalFetch = window.fetch.bind(window);
  let token = sessionStorage.getItem('cloud-recording-token'), active = false, recorder, stream, timer, flushing = false;
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
  panel.innerHTML = '<p>经家长同意后，将记录现场声音、语音输入、转写文字和 AI 回复，上传至研究者的私有云端存储。停止记录后将不再收集。请保持本页打开；切换页面或锁屏可能中断录音。关闭网页前请等待上传完成。</p><label>家庭/被试编号 <input aria-label="记录家庭编号" maxlength="80"></label> <button type="button">同意并开始记录</button> <button type="button" disabled>停止记录</button><p role="status"></p>';
  document.body.prepend(panel);
  const [start, stop] = panel.querySelectorAll('button'); const status = panel.querySelector('[role=status]');
  const say = text => status.textContent = text;
  async function flush() {
    if (flushing) return;
    flushing = true;
    try {
      const rows = await transaction('readonly', s => s.getAll());
      for (const row of rows) {
        const response = await originalFetch('/api/recording/upload', { method: 'POST', headers: { 'Content-Type': row.type, 'X-Recording-Session': row.token, 'X-Recording-File': row.id + '.' + row.ext }, body: row.body, signal: AbortSignal.timeout(25000) });
        if (!response.ok) throw new Error('上传未完成');
        await transaction('readwrite', s => s.delete(row.id));
      }
      say(active ? '正在记录；当前记录已上传' : '当前待上传记录已全部保存');
    } catch { say('有记录等待上传，将自动重试。请保持本页打开。'); }
    finally { flushing = false; }
  }
  async function queue(body, type, ext, sessionToken = token) {
    try {
      const id = crypto.randomUUID();
      await transaction('readwrite', s => s.put({ id, token: sessionToken, body, type, ext }));
      void flush();
      return id + '.' + ext;
    } catch { say('本地暂存失败，请停止记录并检查设备存储空间。'); stop.click(); }
  }
  const event = (data, sessionToken = token) => queue(new Blob([JSON.stringify({ ...data, at: new Date().toISOString(), page: location.pathname, participant: panel.querySelector('input').value })]), 'application/json', 'json', sessionToken);
  window.fetch = async function(input, options = {}) {
    const path = new URL(typeof input === 'string' ? input : input.url, location.href).pathname;
    const capture = active && ['/api/chat', '/api/warmup', '/api/transcribe', '/api/tts'].includes(path);
    const sessionToken = token, requestId = crypto.randomUUID();
    if (capture) {
      if (options.body instanceof Blob) {
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
    } catch (error) { if (capture) await event({ kind: 'request_error', requestId, path, message: error.message }, sessionToken); throw error; }
  };
  start.onclick = async () => {
    start.disabled = true;
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
      // Each segment is a complete playable file, rather than an undecodable WebM fragment.
      function segment() {
        if (!active) return;
        const mimeType = ['audio/webm;codecs=opus', 'audio/mp4'].find(t => MediaRecorder.isTypeSupported(t));
        const current = recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        const segmentToken = token;
        const startedAt = new Date().toISOString();
        current.ondataavailable = async e => { if (e.data.size) { const file = await queue(e.data, current.mimeType, current.mimeType.includes('mp4') ? 'mp4' : 'webm', segmentToken); await event({ kind: 'ambient_audio', file, startedAt }, segmentToken); } };
        current.onstop = () => { if (active) segment(); else stream?.getTracks().forEach(t => t.stop()); };
        current.onerror = () => { say('现场录音中断，请停止后重试'); stop.click(); };
        current.start(); timer = setTimeout(() => { if (current.state === 'recording') current.stop(); }, 10000);
      }
      segment(); say('正在记录，每约 10 秒自动保存一段现场录音');
    } catch (error) { active = false; stream?.getTracks().forEach(t => t.stop()); start.disabled = false; stop.disabled = true; panel.querySelector('input').disabled = false; say(error.message); }
  };
  stop.onclick = () => {
    active = false; clearTimeout(timer); if (recorder?.state === 'recording') recorder.stop(); else stream?.getTracks().forEach(t => t.stop());
    start.disabled = false; stop.disabled = true; panel.querySelector('input').disabled = false;
    void event({ kind: 'recording_stop' }); say('已停止，正在保存剩余记录…');
  };
  window.addEventListener('online', flush); setInterval(flush, 15000); void flush();
  document.addEventListener('visibilitychange', () => { if (active) void event({ kind: 'visibility', state: document.visibilityState }); });
})();
