import { mergeRanges, hasFullCoverage } from './video-progress.js';
(() => {
  const host = window.parent !== window ? window.parent.XiaoxingRecording : null;
  const content = document.getElementById('content'), status = document.getElementById('status');
  if (!host || host.condition() !== '3') { content.textContent = '请从网站首页输入家庭 ID 后进入活动。'; return; }
  const phase = 'activity';
  const topics = ['戳不破的泡泡', '烟雾瀑布'];
  const sources = { '戳不破的泡泡': '/videos/戳不破的泡泡.mp4', '烟雾瀑布': '/videos/烟雾瀑布.mp4' };
  window.experimentData = { condition: 'parent-child', participant: host.participant(), events: [], completedTopics: [] };
  const log = (type, data = {}) => {
    const event = { kind: type, page: '/parent-child.html', phase, ...data };
    window.experimentData.events.push({ ...event, at: new Date().toISOString() });
    return host.record(event);
  };
  void log('page_open');
  document.querySelector('style')?.remove();
  const sharedStyle = document.createElement('link'); sharedStyle.rel = 'stylesheet'; sharedStyle.href = '/activity.css'; document.head.append(sharedStyle);
  const extraStyle = document.createElement('style');
  extraStyle.textContent = `.parent-guidance{max-height:none;min-height:220px;padding:24px;display:block;line-height:1.8;font-size:18px}.parent-guidance h2{font-size:24px;margin:0 0 18px}.parent-guidance p{margin:0 0 18px}.parent-guidance ul{padding-left:24px}.parent-reminders{border-top:1px solid #e0e9ee;margin-top:24px;padding:20px;border-radius:16px;background:#fff8e7}.parent-reminders p:last-child{margin-bottom:0}.parent-finish{flex-shrink:0;margin-top:16px}.parent-finish button{width:100%}.parent-finish p{color:#607d8b;text-align:center;font-size:15px;min-height:24px}@media(max-width:1000px){.parent-guidance{height:auto;max-height:65vh;flex:auto}}`;
  document.head.append(extraStyle);
  const main = document.querySelector('main'); main.className = 'page';
  main.innerHTML = `<div class="activity-layout">
<section class="card video-card" aria-label="科学主题视频">
<div class="badge">科学视频</div><h2 class="video-heading" id="videoTitle">请选择一个科学主题</h2>
<p class="video-caption">选择主题后，这里会播放对应的视频。每看完一个视频，你们都可以一起讨论。</p>
<div id="videoPlaceholder" class="video-placeholder">请点击下方主题按钮，选择先观看的视频。</div>
<video id="topicVideo" class="video-frame" controls playsinline preload="metadata" hidden></video>
<div id="topics" class="video-topics" aria-label="选择视频主题"></div>
<button id="replayVideoButton" class="video-topic-button" disabled>从头重播视频</button>
<p id="status" class="video-caption" role="status"></p></section>
<section class="card chat-card" aria-label="亲子活动指导">
<div class="chat-header"><div class="chat-title-row"><div class="badge">科学小视频活动</div></div></div>
<div class="chat-box parent-guidance" tabindex="0" aria-label="活动介绍与重要提醒">
<div><h2>一起来探索科学吧！🌟</h2><p>亲爱的家长和小朋友，你们好！</p>
<p>今天，你们会一起来探索一些有趣的科学小现象！</p>
<p>接下来，你们会观看两个有趣的科学小视频。<strong>每看完一个视频，你们都可以一起聊聊视频中的现象</strong>，提出自己好奇的问题、分享猜想和发现，或者讨论彼此的想法。</p>
<p>今天有两个科学主题：</p><ul><li><strong>主题 1：戳不破的泡泡</strong></li><li><strong>主题 2：烟雾瀑布</strong></li></ul>
<p><strong>你们可以自由选择观看顺序。看完第一个视频后，可以先一起讨论，等讨论结束后，再选择另一个视频继续观看和讨论。</strong></p>
<p>两个主题都探索完之后，就可以点击下方的 <strong>“结束今天的互动”</strong> 按钮啦！</p></div>
<div class="parent-reminders" aria-label="重要提醒"><p><strong>这里没有标准答案，也没有对错之分。</strong> 遇到不确定的问题也没有关系，可以说说各自的想法。</p>
<p><strong>讨论过程中，<span style="color:#d32f2f">请不要使用搜索引擎、AI 工具或其他外部资料来寻找答案</span>。</strong></p></div></div>
<div class="parent-finish"><button id="finishActivity" class="primary" disabled aria-describedby="finishHint">结束今天的互动</button><p id="finishHint" role="status">请先观看完两个科学视频。</p></div></section></div>`;
  const video = document.getElementById('topicVideo'), finish = document.getElementById('finishActivity');
  const videoStatus = document.getElementById('status');
  const replay = document.getElementById('replayVideoButton');
  const watched = Object.fromEntries(topics.map(name => [name, []]));
  let topic = null;
  function rememberPlayed() {
    if (!topic) return;
    for (let i = 0; i < video.played.length; i++) watched[topic].push([video.played.start(i), video.played.end(i)]);
    watched[topic] = mergeRanges(watched[topic]);
  }
  function updateFinish() {
    finish.disabled = window.experimentData.completedTopics.length !== topics.length;
    document.getElementById('finishHint').textContent = finish.disabled ? '请先观看完两个科学视频。' : '两个视频均已完整播放，讨论结束后即可点击结束。';
  }
  for (const name of topics) {
    const button = document.createElement('button'); button.className = 'video-topic-button'; button.textContent = name; button.dataset.topic = name;
    button.onclick = () => {
      if (topic === name && !video.error) return;
      rememberPlayed(); video.pause(); topic = name;
      void log('topic_selected', { topic });
      document.getElementById('videoTitle').textContent = name;
      video.src = sources[name]; video.hidden = false; video.load(); replay.disabled = false;
      document.getElementById('videoPlaceholder').hidden = true;
      for (const item of document.getElementById('topics').children) item.classList.toggle('active', item.dataset.topic === name);
      videoStatus.textContent = '点击视频播放按钮观看；看完后可以自由讨论，也可以重复观看。';
    };
    document.getElementById('topics').append(button);
  }
  video.onplay = () => { void log('video_play', { topic, seconds: video.currentTime }); };
  video.onpause = () => { rememberPlayed(); void log('video_pause', { topic, seconds: video.currentTime }); };
  video.ontimeupdate = rememberPlayed;
  video.onended = () => {
    rememberPlayed();
    const complete = hasFullCoverage(watched[topic], video.duration);
    if (complete && !window.experimentData.completedTopics.includes(topic)) window.experimentData.completedTopics.push(topic);
    void log('video_ended', { topic, complete, duration: video.duration, playedRanges: watched[topic] });
    videoStatus.textContent = complete ? '这个视频看完啦！可以一起讨论，或选择另一个主题。' : '此视频还有未播放的部分，请完整观看后再结束活动。';
    updateFinish();
  };
  video.onerror = () => { videoStatus.textContent = '视频加载失败，请检查网络后点击“从头重播视频”重试。'; void log('video_error', { topic, code: video.error?.code }); };
  replay.onclick = () => { rememberPlayed(); if (video.error) video.load(); video.currentTime = 0; video.play().catch(() => { videoStatus.textContent = '请点击视频播放按钮。'; }); void log('video_replay', { topic }); };
  finish.onclick = async () => {
    if (window.experimentData.completedTopics.length !== topics.length) return;
    finish.disabled = true; video.pause(); await log('activity_complete'); host.finish();
  };
})();
