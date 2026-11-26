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
  const initialGuidance = guided ? document.getElementById('guidance').innerHTML : '';
  const nativeFetch = window.fetch.bind(window);
  let current = null, active = false, finishing = false, uploading = false, pending = 0, finishRequested = false, writes = Promise.resolve();
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
    start.textContent = '同意并继续'; start.style.cssText = 'display:block;margin:20px auto 0'; stop.hidden = true;
    const consent = document.createElement('p');
    consent.textContent = '点击“同意并继续”，表示家长同意将本次网页互动产生的文字内容保存至研究者的私有云端，仅用于本次研究。网站不会保存录音文件。';
    start.before(consent);
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
      if (rows.some(r => r.ready)) { say('完整 JSON 已保存到云端，可以关闭页面。'); if (finishRequested) showThanks(); }
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
    condition: () => current?.document.conditionCode,
    record: data => active ? record(data) : Promise.resolve(),
    finish: () => stop.click(),
    openActivity() {
      if (active) void record({ kind: 'formal_activity_open', page: '/activity' });
      showFrame('/activity');
    }
  };
  function showFrame(path) {
    if (current?.document.conditionCode === '3') path = '/parent-child.html?phase=activity';
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


  const conditionOneSteps = [
    {
      title: '欢迎来到科学探索！', button: '下一步',
      content: `<p>亲爱的家长和小朋友，欢迎你们！</p>
<p>今天，你们会一起观看一些有趣的科学小视频，聊聊视频中的奇妙现象，还会认识一位 <strong>AI</strong> 伙伴“<strong style="color:#d32f2f">小星</strong>”！</p>
<p>在接下来的探索中，你们可以和小星一起提问、猜想、分享想法，探索这些有趣的科学现象。</p>
<p><strong>这里没有标准答案，也没有对错之分。</strong> 我们想了解的是，大家在探索科学问题时，会怎样交流和思考。</p>
<p>所以，不用担心说错，也不需要提前准备。按照自己喜欢的方式，轻松、自由地聊天就好！</p>
<p>准备好了吗？让我们一起开启今天的科学探索吧！</p>`
    },
    {
      title: '我们可以怎样一起探索？', button: '我明白了，下一步',
      content: `<p>在接下来的活动中，你们会一起观看科学视频，并和 <strong>AI</strong> 伙伴“小星”一起讨论视频中有趣的现象。</p>
<p><strong>家长和小朋友都可以自由地参与讨论！</strong></p>
<p>你们可以像平时一样互相交流，也可以随时和小星说话。例如：</p>
<ul><li>向小星提出自己好奇的问题；</li><li>回答小星提出的问题；</li><li>和对方分享自己的猜想或发现；</li><li>一起聊聊小星的回答，或者继续提出新的问题。</li></ul>
<p>你们可以根据自己的兴趣和想法，自然地交流和探索。</p>
<p>我们希望了解大家最自然、真实的交流方式，因此<strong>不需要按照特定的方式进行交流，也不用追求正确答案</strong>。</p>`
    },
    {
      title: '开始前的小准备', button: '确认并进入热身',
      content: `<p>马上就要开始啦！请家长和小朋友先完成以下准备。</p>
<h2>1. 打开录音</h2><p>请使用手机或其他设备的录音功能，<strong style="color:#d32f2f">现在开始录音</strong>，确保能够清楚录下整个活动过程中的所有声音，包括大家的说话声和网页播放的声音。</p>
<p>如果使用同一部手机进行网页互动和录音，请确认切换到网页后，录音仍能正常进行。</p>
<h2>2. 保持录音直到活动结束</h2><p>请在整个活动过程中保持录音，不要中途暂停或关闭，直到网页出现结束提示后再停止。</p>
<h2>3. 先来试一试</h2><p>正式探索前，你们会先进入一个简单的热身练习，熟悉接下来的操作方式。</p>
<p>请家长确认：</p><label style="display:block;margin:20px 0;font-size:18px"><input type="checkbox" id="phone-recording-confirmed"> 我们已经<strong>开始录音</strong>，并确认能够清楚录下活动过程中的所有声音。</label>`
    }
  ];
  const conditionTwoSteps = [
    {
      title: '欢迎来到科学探索！', button: '下一步',
      content: `<p>亲爱的小朋友，欢迎你！</p>
<p>今天，你会观看一些有趣的科学小视频，聊聊视频中的奇妙现象，还会认识一位 <strong>AI</strong> 伙伴“<strong style="color:#d32f2f">小星</strong>”！</p>
<p>在接下来的探索中，你可以和小星一起提问、猜想、分享想法，探索这些有趣的科学现象。</p>
<p><strong>这里没有标准答案，也没有对错之分。</strong> 我们想了解的是，小朋友在探索科学问题时，会怎样交流和思考。</p>
<p>所以，不用担心说错，也不需要提前准备。按照自己喜欢的方式，轻松、自由地聊天就好！</p>
<p>准备好了吗？让我们一起开启今天的科学探索吧！</p>`
    },
    {
      title: '我们可以怎样一起探索？', button: '我明白了，下一步',
      content: `<p>在接下来的活动中，小朋友会和 <strong>AI</strong> 伙伴“小星”一起讨论视频中有趣的科学现象。</p>
<p><strong>小朋友可以自由地与小星交流！</strong></p>
<p>你可以根据自己的兴趣和想法，向小星提出好奇的问题、回答小星的问题，或者分享自己的猜想和发现。</p>
<p>在这个过程中，我们希望小朋友自己与小星交流和探索。</p>
<p>家长可以帮助孩子操作设备，例如点击按钮、发送消息等。但是，在正式互动过程中，请家长不要代替孩子向小星提问或回答问题，也不要帮助孩子思考或组织答案。</p>
<p>即使孩子暂时不知道该问什么、该如何回答，也请尽量让孩子自己决定。</p>
<p>这里没有标准答案，也不需要提前准备。 我们希望了解小朋友与小星交流时最自然、真实的表现，因此不需要刻意引导孩子，也不用追求正确答案。</p>`
    },
    {
      ...conditionOneSteps[2],
      content: conditionOneSteps[2].content.replace('正式探索前，你们会先进入一个简单的热身练习，熟悉接下来的操作方式。', '正式探索前，小朋友会先进入一个简单的热身练习，熟悉如何按住说话、发送消息和听取小星的回复。</p><p>家长可以在热身过程中帮助孩子熟悉这些操作。正式开始后，请尽量让孩子独立与小星交流。')
    }
  ];
  const conditionThreeSteps = [
    {
      title: '欢迎来到科学探索！', button: '下一步',
      content: `<p>亲爱的家长和小朋友，欢迎你们！</p>
<p>今天，你们会一起观看一些有趣的科学小视频，聊聊视频中的奇妙现象！</p>
<p>在接下来的探索中，你们可以一起提问、猜想、分享想法，探索这些有趣的科学现象。</p>
<p><strong>这里没有标准答案，也没有对错之分。</strong> 我们想了解的是，大家在探索科学问题时，会怎样交流和思考。</p>
<p>所以，不用担心说错，也不需要提前准备。按照自己喜欢的方式，轻松、自由地聊天就好！</p>
<p>准备好了吗？让我们一起开启今天的科学探索吧！</p>`
    },
    {
      title: '我们可以怎样一起探索？', button: '我明白了，下一步',
      content: `<p>在接下来的活动中，你们会一起观看科学视频，并讨论视频中有趣的现象。</p>
<p><strong>家长和小朋友都可以自由地参与讨论！</strong></p>
<p>你们可以像平时一样互相交流。例如：</p>
<ul><li>提出自己好奇的问题；</li><li>回答对方提出的问题；</li><li>和对方分享自己的猜想或发现；</li><li>一起讨论不同的想法，或者继续提出新的问题。</li></ul>
<p>你们可以根据自己的兴趣和想法，自然地交流和探索。</p>
<p><strong>需要特别注意的是，在整个讨论过程中，<span style="color:#d32f2f">请不要使用搜索引擎、<strong>AI</strong> 工具或其他外部资料来寻找答案</span>。</strong> 你们可以根据自己的知识、经验和想法自由讨论，即使遇到不确定的问题也完全没有关系！</p>
<p>我们希望了解大家最自然、真实的交流方式，因此<strong>不需要按照特定的方式进行交流，也不用追求正确答案</strong>。</p>`
    },
    {
      ...conditionOneSteps[2], button: '确认并开始探索',
      content: conditionOneSteps[2].content.replace('<h2>3. 先来试一试</h2><p>正式探索前，你们会先进入一个简单的热身练习，熟悉接下来的操作方式。</p>', '<h2>3. 准备开始</h2><p>确认录音已开始后，点击下方按钮，进入科学探索。你们可以自由选择视频，观看后一起讨论。</p>')
    }
  ];
  const conditionNames = { '1': 'parent-ai-child', '2': 'ai-child', '3': 'parent-child' };
  function showConditionStep(index) {
    const steps = { '1': conditionOneSteps, '2': conditionTwoSteps, '3': conditionThreeSteps }[current.document.conditionCode];
    const step = steps[index], main = document.getElementById('guidance');
    panel.hidden = true; main.hidden = false;
    main.innerHTML = '<h1></h1>' + step.content;
    main.querySelector('h1').textContent = step.title;
    const button = document.createElement('button'); button.type = 'button'; button.textContent = step.button;
    const navigation = document.createElement('div');
    navigation.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:16px;margin-top:28px';
    const back = document.createElement('button'); back.type = 'button'; back.textContent = '← 上一页';
    back.onclick = () => {
      void record({ kind: 'guidance_back', fromStep: index + 2, toStep: index + 1 });
      if (index > 0) showConditionStep(index - 1);
      else {
        main.innerHTML = initialGuidance; main.hidden = false; panel.hidden = false;
        start.disabled = false; input.disabled = true;
        say('家庭 ID 已保留，点击“同意并继续”进入欢迎页。');
        window.scrollTo(0, 0);
      }
    };
    navigation.append(back, button); main.append(navigation);
    const checkbox = main.querySelector('#phone-recording-confirmed');
    if (checkbox) {
      checkbox.checked = Boolean(current.document.phoneRecordingAcknowledged);
      button.disabled = !checkbox.checked;
      checkbox.onchange = () => {
        button.disabled = !checkbox.checked;
        current.document.phoneRecordingAcknowledged = checkbox.checked;
        void record({ kind: 'recording_confirmation_changed', confirmed: checkbox.checked });
      };
    }
    button.onclick = async () => {
      if (checkbox && !checkbox.checked) return;
      button.disabled = true;
      await record({ kind: 'guidance_step_complete', step: index + 2, title: step.title, phoneRecordingConfirmed: checkbox ? true : undefined });
      if (index < steps.length - 1) showConditionStep(index + 1);
      else { current.document.phoneRecordingConfirmedAt = new Date().toISOString(); await persist();
        if (current.document.conditionCode === '3') { await record({ kind: 'formal_activity_open', page: '/parent-child.html' }); showFrame('/activity'); }
        else showFrame('/warmup'); }
    };
    window.scrollTo(0, 0);
  }

  start.onclick = async () => {
    if (guided && current && !current.ready) {
      const code = current.document.participant.slice(-1);
      if (!conditionNames[code]) { say('本机旧记录不属于已开放的条件，请联系研究者处理旧记录。'); return; }
      current.document.condition = conditionNames[code]; current.document.conditionCode = code;
      active = true; start.disabled = true;
      showConditionStep(0);
      return;
    }
    start.disabled = true;
    try {
      if (!input.value.trim()) throw new Error('请先填写家庭/被试编号');
      const conditionCode = input.value.trim().slice(-1);
      if (guided && !conditionNames[conditionCode]) throw new Error('家庭 ID 尾号应为 1、2 或 3，请检查研究者提供的编号。');
      const response = await nativeFetch('/api/recording/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ consent: true }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || '无法开始记录');
      current = { id: data.token.split('.')[0], token: data.token, ready: false, document: { schemaVersion: 3, condition: conditionNames[conditionCode], conditionCode, participant: input.value.trim(), consentAt: new Date().toISOString(), startedAt: new Date().toISOString(), endedAt: null, audioSaved: false, events: [] } };
      await persist();
      if (guided) { sessionStorage.removeItem('xiaoxing-warmup-v1'); sessionStorage.removeItem('xiaoxing-warmup-handoff'); }
      active = true; input.disabled = true; stop.disabled = false;
      await record({ kind: 'session_start', page: location.pathname }); say('正在记录文字对话；热身与正式活动共用一份 JSON。');
      if (guided) showConditionStep(0);
    } catch (error) { start.disabled = false; say(error.message); }
  };
  stop.onclick = async () => {
    if (!active) return;
    finishRequested = true; active = false; finishing = true; stop.disabled = true;
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
        if (guided) {
          // Always keep the instructions visible on entry; resume only on an explicit click.
          active = false; start.disabled = false;
          start.textContent = '同意并继续';
          say('发现本机未结束的记录。已有文字会保留，阅读指导语后点击按钮进入热身。');
        }
      } else await flush();
    } catch { say('无法打开本地存储，请检查浏览器设置。'); }
  }
  window.addEventListener('online', flush); setInterval(flush, 15000); void restore();
  window.addEventListener('beforeunload', e => { if (active || finishing || uploading) { e.preventDefault(); e.returnValue = ''; } });
})();
