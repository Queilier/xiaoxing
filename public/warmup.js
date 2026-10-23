const $ = id => document.getElementById(id);
const STORAGE_KEY = 'xiaoxing-warmup-v1';
const welcome = '你好呀，我是小星！想问什么都可以，我们先聊聊天吧。';
let history = [], stage = 'host', busy = false, held = false, recorder = null, stream = null;
let audioURL = '', replyToReplay = '', requestController = null, leaving = false;
const audio = new Audio();
audio.setAttribute('playsinline', 'true');
function save() {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ history, stage })); } catch {}
}
function message(role, text, speaker) {
  const bubble = document.createElement('div'); bubble.className = 'message' + (role === 'user' ? ' user' : '');
  if (role === 'user') { const label = document.createElement('span'); label.className = 'speaker'; label.textContent = speaker === 'host' ? '主试示范' : '小朋友'; bubble.append(label); }
  bubble.append(document.createTextNode(text)); $('chat').append(bubble); $('chat').scrollTop = $('chat').scrollHeight;
}
function setStage(value) {
  stage = value;
  $('hostStep').setAttribute('aria-pressed', String(stage === 'host'));
  $('childStep').setAttribute('aria-pressed', String(stage === 'child'));
  save();
}
function setBusy(value) { busy = value; for (const id of ['send', 'hold', 'replay', 'hostStep', 'childStep']) $(id).disabled = value; }
async function request(url, options) {
  requestController = new AbortController();
  const timer = setTimeout(() => requestController.abort(), 45000);
  try {
    const response = await fetch(url, { ...options, signal: requestController.signal });
    if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || '请求失败，请重试。'); }
    // 在读取完整响应期间保持超时，避免卡在下载音频。
    return url === '/api/tts' ? await response.blob() : await response.json();
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('等待超时了，请再试一次。');
    throw error;
  } finally { clearTimeout(timer); requestController = null; }
}
function clearAudio() { audio.pause(); audio.removeAttribute('src'); if (audioURL) URL.revokeObjectURL(audioURL); audioURL = ''; }
async function playReply(text) {
  replyToReplay = text; $('replay').hidden = false;
  if (!audioURL) {
    $('status').textContent = '小星正在准备声音…';
    const blob = await request('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
    if (blob.size < 1000) throw new Error('语音没有生成成功，请点“再听一次”重试。');
    audioURL = URL.createObjectURL(blob); audio.src = audioURL;
  }
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('播放等待超时')), 10000);
      audio.play().then(resolve, reject).finally(() => clearTimeout(timer));
    });
    $('status').textContent = '小星正在说话…';
  }
  catch { $('status').textContent = '文字回复准备好啦，点“再听一次小星的话”播放声音。'; }
}
audio.addEventListener('ended', () => { $('status').textContent = '轮到你啦！可以继续按住说话，或者打字提问。'; });
audio.addEventListener('error', () => { $('status').textContent = '声音播放失败，可以点“再听一次”重试，或继续提问。'; });
async function ask(text, via = 'text') {
  if (busy || !text.trim()) return;
  setBusy(true); clearAudio(); replyToReplay = ''; $('replay').hidden = true;
  const question = text.trim(), speaker = stage, prior = history.slice();
  message('user', question, speaker); history.push({ role: 'user', text: question, speaker, via, at: new Date().toISOString() }); save(); $('question').value = '';
  $('status').textContent = '小星正在想一想…';
  try {
    const data = await request('/api/warmup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question, history: prior }) });
    if (!data.reply) throw new Error('小星暂时没有回复，请再试一次。');
    message('assistant', data.reply); history.push({ role: 'assistant', text: data.reply, at: new Date().toISOString() }); save();
    if (speaker === 'host') setStage('child');
    try { await playReply(data.reply); } catch (error) { $('status').textContent = '小星已经回复，语音暂时失败：' + error.message; }
  } catch (error) {
    $('question').value = question;
    $('status').textContent = '这次没有成功：' + error.message + ' 可以再点发送。';
  } finally { setBusy(false); }
}
$('questionForm').addEventListener('submit', event => { event.preventDefault(); if (!held) ask($('question').value); });
$('hostStep').onclick = () => setStage('host'); $('childStep').onclick = () => setStage('child');
$('replay').onclick = async () => { if (busy || !replyToReplay) return; setBusy(true); try { await playReply(replyToReplay); } catch (error) { $('status').textContent = error.message; } finally { setBusy(false); } };
function stopTracks() { stream?.getTracks().forEach(track => track.stop()); stream = null; }
async function beginRecording(event) {
  if (event.type === 'pointerdown' && event.button !== 0) return;
  event.preventDefault(); if (busy || held) return;
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { $('status').textContent = '这个浏览器暂不支持录音，可以先练习打字发送。'; return; }
  held = true; audio.pause(); $('hold').classList.add('recording'); $('hold').textContent = '松开发送'; $('status').textContent = '正在准备麦克风…';
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    if (!held) { stopTracks(); $('status').textContent = '麦克风已准备好，再按住按钮说话吧。'; return; }
    const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(type => MediaRecorder.isTypeSupported(type));
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const activeRecorder = recorder;
    activeRecorder.onerror = () => {
      held = false; stopTracks(); setBusy(false);
      $('hold').classList.remove('recording'); $('hold').textContent = '按住说话';
      $('status').textContent = '录音没有成功，请再试一次，或先练习打字发送。';
    };
    const chunks = []; activeRecorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    activeRecorder.onstop = async () => {
      stopTracks(); const blob = new Blob(chunks, { type: activeRecorder.mimeType }); recorder = null;
      if (leaving) return;
      if (blob.size < 1000) { setBusy(false); $('status').textContent = '这次太短啦，按住按钮说完一句话再松开吧。'; return; }
      setBusy(true); $('status').textContent = '小星正在听你说了什么…';
      let text;
      try {
        const data = await request('/api/transcribe?mode=warmup', { method: 'POST', headers: { 'Content-Type': blob.type.split(';')[0] }, body: blob });
        text = data.text?.trim(); if (!text) throw new Error('没有听清，可以再试一次或打字。');
      } catch (error) { $('status').textContent = error.message; }
      finally { setBusy(false); }
      if (text) ask(text, 'voice');
    };
    recorder.start(); $('status').textContent = '正在听，说完后松开按钮就可以啦。';
  } catch { held = false; stopTracks(); $('hold').classList.remove('recording'); $('hold').textContent = '按住说话'; $('status').textContent = '没有开启麦克风。请允许录音，或先用打字练习。'; }
}
function finishRecording(event) {
  if (event) event.preventDefault(); if (!held) return; held = false;
  $('hold').classList.remove('recording'); $('hold').textContent = '按住说话';
  if (recorder?.state === 'recording') { setBusy(true); recorder.stop(); }
}
$('hold').addEventListener('pointerdown', beginRecording);
$('hold').addEventListener('contextmenu', event => event.preventDefault());
window.addEventListener('pointerup', event => { if (held) finishRecording(event); });
window.addEventListener('pointercancel', event => { if (held) finishRecording(event); });
$('hold').addEventListener('keydown', event => { if ([' ', 'Enter'].includes(event.key) && !event.repeat) beginRecording(event); });
$('hold').addEventListener('keyup', event => { if ([' ', 'Enter'].includes(event.key)) finishRecording(event); });
window.addEventListener('blur', () => { if (held) finishRecording(); });
$('formalStart').onclick = () => {
  // 热身记录使用独立键；正式实验页不接收这些对话。
  leaving = true; requestController?.abort(); held = false; stopTracks(); audio.pause();
  try { sessionStorage.setItem('xiaoxing-warmup-handoff', 'true'); } catch {}
  window.location.assign('/activity');
};
window.addEventListener('beforeunload', () => { leaving = true; held = false; stopTracks(); audio.pause(); });
try { const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY)); if (Array.isArray(saved?.history)) { history = saved.history; stage = saved.stage === 'child' ? 'child' : 'host'; } } catch {}
message('assistant', welcome);
for (const item of history) if (['user', 'assistant'].includes(item.role) && typeof item.text === 'string') message(item.role, item.text, item.speaker);
setStage(stage);
