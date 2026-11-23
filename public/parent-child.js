(() => {
  const host = window.parent !== window ? window.parent.XiaoxingRecording : null;
  const content = document.getElementById('content'), status = document.getElementById('status');
  if (!host || host.condition() !== '3') { content.textContent = '请从网站首页输入家庭 ID 后进入活动。'; return; }
  const phase = new URLSearchParams(location.search).get('phase');
  const topics = ['戳不破的泡泡', '烟雾瀑布'];
  const sources = { '戳不破的泡泡': '/videos/戳不破的泡泡.mp4', '烟雾瀑布': '/videos/烟雾瀑布.mp4' };
  window.experimentData = { condition: 'parent-child', participant: host.participant(), events: [], completedTopics: [] };
  const log = (type, data = {}) => {
    const event = { kind: type, page: '/parent-child.html', phase, ...data };
    window.experimentData.events.push({ ...event, at: new Date().toISOString() });
    return host.record(event);
  };
  void log('page_open');
  if (phase !== 'activity') {
    content.innerHTML = '<h1>先来熟悉一下操作</h1><p>家长和小朋友可以一起试试点击下面的按钮。正式活动中，你们会选择视频、观看并自由讨论，讨论完成后点击按钮进入下一个主题。</p><button id="practice">点我试一试</button><p id="practice-result" aria-live="polite"></p><p>熟悉好按钮后，可以点击“正式开始”，开启今天的小活动～</p><button id="begin" class="primary">正式开始 →</button>';
    document.getElementById('practice').onclick = () => { document.getElementById('practice-result').textContent = '操作成功！你们已经会使用按钮啦。'; void log('practice_button'); };
    document.getElementById('begin').onclick = async () => { await log('warmup_complete'); host.openActivity(); };
    return;
  }
  content.innerHTML = '<h1>科学小视频活动</h1><p>请选择一个主题，观看视频后一起自由讨论。不确定答案也没有关系，请根据自己的知识、经验和想法交流。</p><div id="topics"></div><h2 id="topic"></h2><video id="video" controls playsinline preload="metadata" hidden></video><div id="actions" hidden><button id="replay">从头重播视频</button><button id="discuss" disabled>视频看完了，开始讨论</button><p id="discussion-note" hidden>现在可以一起聊聊视频中的现象。讨论结束后，点击下面的按钮继续。</p><button id="done" class="primary" disabled>这个主题讨论完成</button></div>';
  const video = document.getElementById('video'), done = document.getElementById('done'), discuss = document.getElementById('discuss');
  let topic = null;
  for (const name of topics) {
    const button = document.createElement('button'); button.textContent = name; button.dataset.topic = name;
    button.onclick = async () => {
      topic = name; video.pause(); await log('topic_selected', { topic });
      document.getElementById('topic').textContent = name; video.src = sources[name]; video.hidden = false; video.load();
      document.getElementById('topics').hidden = true; document.getElementById('actions').hidden = false;
      discuss.disabled = true; done.disabled = true; document.getElementById('discussion-note').hidden = true;
      status.textContent = '点击视频播放按钮观看；视频结束后可以开始讨论。';
    };
    document.getElementById('topics').append(button);
  }
  video.onplay = () => { void log('video_play', { topic, seconds: video.currentTime }); };
  video.onpause = () => { void log('video_pause', { topic, seconds: video.currentTime }); };
  video.onended = () => { discuss.disabled = false; status.textContent = '视频看完啦！点击“视频看完了，开始讨论”。'; void log('video_ended', { topic }); };
  video.onerror = () => { status.textContent = '视频加载失败，请检查网络后点击“从头重播视频”重试。'; void log('video_error', { topic, code: video.error?.code }); };
  document.getElementById('replay').onclick = () => { if (video.error) video.load(); video.currentTime = 0; video.play().catch(() => { status.textContent = '请点击视频播放按钮。'; }); void log('video_replay', { topic }); };
  discuss.onclick = () => { document.getElementById('discussion-note').hidden = false; done.disabled = false; discuss.disabled = true; status.textContent = '请自由讨论，完成后再继续。'; void log('discussion_start', { topic }); };
  done.onclick = async () => {
    done.disabled = true; await log('discussion_complete', { topic });
    window.experimentData.completedTopics.push(topic);
    if (window.experimentData.completedTopics.length === topics.length) {
      video.pause(); await log('activity_complete');
      document.getElementById('actions').hidden = true;
      status.textContent = '两个主题都已讨论完成，可以结束今天的互动。';
      const finish = document.createElement('button'); finish.textContent = '结束今天的互动'; finish.className = 'primary';
      finish.onclick = () => { finish.disabled = true; host.finish(); }; content.append(finish); return;
    }
    video.pause(); video.hidden = true; document.getElementById('actions').hidden = true;
    document.getElementById('topics').hidden = false;
    for (const button of document.getElementById('topics').children) button.disabled = window.experimentData.completedTopics.includes(button.dataset.topic);
    status.textContent = '请点击另一个主题，继续观看和讨论。';
  };
})();
