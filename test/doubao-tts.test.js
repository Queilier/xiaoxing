import test from "node:test";
import assert from "node:assert/strict";
import { synthesizeDoubaoSpeech } from "../doubao-tts.js";

const key = "test-key";
const audio = Buffer.alloc(1500, 42);
const packet = (data, code = 0) => JSON.stringify({ code, message: "OK", data: data?.toString("base64") });
const options = (fetch) => ({ apiKey: key, fetch });

test("缺少豆包密钥时明确报错，不调用其他服务", async () => {
  let called = false;
  await assert.rejects(synthesizeDoubaoSpeech("你好", {
    apiKey: "", fetch() { called = true; },
  }), { code: "doubao_key_missing", status: 503 });
  assert.equal(called, false);
});

test("发送2.0鉴权、邻家女孩音色和中文指令，并拼接被网络拆开的音频分片", async () => {
  const wire = Buffer.from(`${packet(audio.subarray(0, 700))}\r\n\n${packet(audio.subarray(700))}`);
  const result = await synthesizeDoubaoSpeech("你好，小朋友！", options(async (url, request) => {
    assert.equal(url, "https://openspeech.bytedance.com/api/v3/tts/unidirectional");
    assert.equal(request.headers["X-Api-Key"], key);
    assert.equal(request.headers["X-Api-Resource-Id"], "seed-tts-2.0");
    assert.match(request.headers["X-Api-Request-Id"], /^[a-f0-9-]{36}$/);
    const { req_params: params } = JSON.parse(request.body);
    assert.equal(params.speaker, "zh_female_linjianvhai_uranus_bigtts");
    assert.equal(params.text, "你好，小朋友！");
    assert.equal(params.audio_params.format, "mp3");
    const additions = JSON.parse(params.additions);
    assert.equal(additions.explicit_language, "zh-cn");
    assert.match(additions.context_texts[0], /学龄前/);
    return new Response(new ReadableStream({
      start(controller) {
        for (let i = 0; i < wire.length; i += 17) controller.enqueue(wire.subarray(i, i + 17));
        controller.close();
      },
    }));
  }));
  assert.deepEqual(result, audio);
});

test("兼容任务结束标记", async () => {
  assert.deepEqual(await synthesizeDoubaoSpeech("你好", options(async () =>
    new Response(`${packet(audio)}\n${packet(null, 20000000)}\n`))), audio);
});

test("鉴权失败给出开通提示，不泄露上游请求内容", async () => {
  await assert.rejects(synthesizeDoubaoSpeech("你好", options(async () =>
    new Response(`upstream echoed secret: ${key}`, { status: 403 }))), (error) => {
    assert.equal(error.status, 403);
    assert.match(error.message, /鉴权失败/);
    assert.ok(!error.message.includes(key));
    return true;
  });
});

test("额度或并发限制返回明确提示", async () => {
  await assert.rejects(synthesizeDoubaoSpeech("你好", options(async () =>
    new Response("limited", { status: 429 }))), { status: 429, message: /额度/ });
});

test("后续分片报错时丢弃已收到的音频，不播放截断内容", async () => {
  await assert.rejects(synthesizeDoubaoSpeech("你好", options(async () =>
    new Response(`${packet(audio)}\n${JSON.stringify({ code: 45000000, message: `not enabled ${key}` })}`))), (error) => {
    assert.equal(error.code, "doubao_synthesis_failed");
    assert.ok(!error.message.includes(key));
    return true;
  });
});

test("错误的返回格式不能伪装成音频", async () => {
  await assert.rejects(synthesizeDoubaoSpeech("你好", options(async () =>
    new Response("<html>service unavailable</html>"))), { code: "doubao_invalid_response" });
});

test("正常状态但没有有效音频时仍然报错", async () => {
  await assert.rejects(synthesizeDoubaoSpeech("你好", options(async () =>
    new Response(packet(Buffer.from("tiny"))))), { code: "doubao_empty_audio" });
});

test("超时会取消上游请求并返回可重试错误", async () => {
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(synthesizeDoubaoSpeech("你好", {
      apiKey: key, timeoutMs: 5,
      fetch: async (_, { signal }) => new Promise((_, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }),
    }), { code: "doubao_timeout", status: 504 });
  } finally { clearTimeout(keepAlive); }
});
