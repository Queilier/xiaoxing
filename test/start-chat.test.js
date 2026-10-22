import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const code = html.slice(html.indexOf("    async function speakAssistantReply("), html.indexOf("    function startHoldVoiceInput("));
const greeting = "小朋友你好！让我们一起来进行科学探索吧！你准备好开始了吗～如果你准备好了，可以和我说‘准备好了’！";

function createPage({ id = "001", history = [], phase = "waiting_ready", play } = {}) {
  const status = { innerText: "" };
  const button = { disabled: false };
  const chatBox = { children: [] };
  const played = [], replay = [];
  const data = { chatHistory: [...history], errors: [], experimentState: { phase } };
  const context = {
    isSending: false, isTTSPlaying: false,
    window: { experimentData: data },
    console: { error() {} },
    document: { getElementById: (name) => ({ status, startChatBtn: button, chatBox })[name] },
    getParticipantId: () => id,
    unlockAudio: async () => {},
    ensureParticipantSession() {}, syncExperimentState() {}, saveExperimentData() {}, recordEvent() {},
    addMessage: (role, text) => chatBox.children.push({ role, text }),
    renderSavedHistory: () => chatBox.children.push(...data.chatHistory),
    playTTS: async (text) => { played.push(text); if (play) await play(); },
    showTTSReplayButton: (text, reason) => replay.push({ text, reason }),
  };
  vm.createContext(context);
  vm.runInContext(code, context);
  return { context, status, button, chatBox, data, played, replay };
}

test("点击开始后，显示并朗读开场白，保留重播按钮", async () => {
  const page = createPage();
  await page.context.startChat();
  assert.deepEqual(page.played, [greeting]);
  assert.equal(page.chatBox.children.length, 1);
  assert.equal(page.data.chatHistory.length, 1);
  assert.equal(page.replay[0].text, greeting);
  assert.match(page.status.innerText, /准备好了/);
  assert.equal(page.button.disabled, false);
  assert.equal(page.context.isSending, false);
});

test("没有被试编号时不生成开场语音", async () => {
  const page = createPage({ id: "" });
  await page.context.startChat();
  assert.equal(page.played.length, 0);
  assert.equal(page.data.chatHistory.length, 0);
  assert.match(page.status.innerText, /输入被试编号/);
});

test("连续点击开始不会重复生成开场或插入重复消息", async () => {
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const page = createPage({ play: () => pending });
  const first = page.context.startChat();
  await new Promise(setImmediate);
  assert.equal(page.button.disabled, true);
  await page.context.startChat();
  assert.equal(page.played.length, 1);
  assert.equal(page.data.chatHistory.length, 1);
  finish();
  await first;
  assert.equal(page.button.disabled, false);
});

test("开场生成或播放失败时仍可重试，开始按钮不会卡住", async () => {
  const page = createPage({ play: () => { throw new Error("测试语音失败"); } });
  await page.context.startChat();
  assert.equal(page.data.errors.length, 1);
  assert.match(page.status.innerText, /测试语音失败/);
  assert.equal(page.replay[0].text, greeting);
  assert.equal(page.button.disabled, false);
  assert.equal(page.context.isSending, false);
});

test("刷新后仅有开场白的会话，点击开始可以朗读，不重复插入", async () => {
  const page = createPage({ history: [{ role: "assistant", text: greeting }] });
  await page.context.startChat();
  assert.deepEqual(page.played, [greeting]);
  assert.equal(page.data.chatHistory.length, 1);
  assert.equal(page.chatBox.children.length, 1);
});

test("恢复进行中的对话不会重新朗读开场白", async () => {
  const page = createPage({ history: [{ role: "assistant", text: greeting }, { role: "user", text: "准备好了" }], phase: "waiting_name" });
  await page.context.startChat();
  assert.equal(page.played.length, 0);
  assert.equal(page.chatBox.children.length, 2);
});

test("普通回复仍使用同一套朗读与重播流程", async () => {
  const page = createPage();
  await page.context.speakAssistantReply("你好，小朋友！");
  assert.deepEqual(page.played, ["你好，小朋友！"]);
  assert.equal(page.replay[0].text, "你好，小朋友！");
  assert.match(page.status.innerText, /你可以继续按住按钮说话/);
});
