import { randomUUID } from "node:crypto";

const ENDPOINT = "https://openspeech.bytedance.com/api/v3/tts/unidirectional";
const VOICE = "zh_female_linjianvhai_uranus_bigtts";

function speechError(message, code, status = 502) {
  return Object.assign(new Error(message), { code, status });
}

// 火山引擎 V3 返回逐行 JSON，其中 data 是音频分片的 base64。
// 只有整次请求成功后才返回 MP3，避免把服务端错误当作音频播放。
export async function synthesizeDoubaoSpeech(text, options = {}) {
  const apiKey = options.apiKey ?? process.env.DOUBAO_API_KEY;
  if (!apiKey?.trim()) {
    throw speechError("尚未配置豆包语音密钥。请在服务端 .env 中填写 DOUBAO_API_KEY，并开通豆包语音合成 2.0。", "doubao_key_missing", 503);
  }
  const signal = AbortSignal.timeout(options.timeoutMs ?? 40000);
  const fetchSpeech = options.fetch ?? globalThis.fetch;
  try {
    const response = await fetchSpeech(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": apiKey.trim(),
        "X-Api-Resource-Id": "seed-tts-2.0",
        "X-Api-Request-Id": randomUUID(),
      },
      body: JSON.stringify({
        req_params: {
          text,
          speaker: options.voice ?? process.env.DOUBAO_TTS_VOICE ?? VOICE,
          audio_params: { format: "mp3", sample_rate: 24000, speech_rate: 5 },
          additions: JSON.stringify({
            explicit_language: "zh-cn",
            context_texts: ["请用自然流畅的普通话，以年轻女老师和学龄前小朋友聊天的方式说话。语气积极、温暖、好奇，轻快而不夸张，按语意自然停顿，不要逐字慢读。"],
          }),
        },
      }),
      signal,
    });
    if (!response.ok) {
      // 不把可能包含鉴权信息的原始错误或请求头发送给浏览器。
      const hint = [401, 403].includes(response.status)
        ? "豆包语音鉴权失败，请检查 API Key、所属项目和语音合成 2.0 的开通状态。"
        : response.status === 429
          ? "豆包语音调用受限，请检查试用额度、账户余额或并发限制。"
          : `豆包语音服务返回 HTTP ${response.status}，请稍后重试。`;
      await response.body?.cancel();
      throw speechError(hint, "doubao_http_error", response.status);
    }
    if (!response.body) throw speechError("豆包语音没有返回音频内容。", "doubao_empty_audio");

    const audio = [];
    let totalBytes = 0;
    let pending = "";
    const decoder = new TextDecoder();
    const consume = (line) => {
      if (!line.trim()) return;
      let frame;
      try { frame = JSON.parse(line); } catch {
        throw speechError("豆包语音返回了无法解析的数据，请重试。", "doubao_invalid_response");
      }
      // V3 正常分片为 0，部分版本用 20000000 表示任务结束。
      if (frame.code !== 0 && frame.code !== 20000000) {
        const detail = String(frame.message || "未知错误").replaceAll(apiKey.trim(), "[redacted]").slice(0, 220);
        throw speechError(`豆包语音生成失败（${frame.code}）：${detail}`, "doubao_synthesis_failed");
      }
      if (typeof frame.data === "string" && frame.data) {
        const chunk = Buffer.from(frame.data, "base64");
        totalBytes += chunk.length;
        if (totalBytes > 10 * 1024 * 1024) throw speechError("语音内容过长，请缩短回答后重试。", "doubao_audio_too_large");
        audio.push(chunk);
      }
    };
    for await (const chunk of response.body) {
      pending += decoder.decode(chunk, { stream: true });
      let newline;
      while ((newline = pending.indexOf("\n")) !== -1) {
        consume(pending.slice(0, newline));
        pending = pending.slice(newline + 1);
      }
      if (pending.length > 16 * 1024 * 1024) throw speechError("豆包语音响应过大。", "doubao_invalid_response");
    }
    pending += decoder.decode();
    consume(pending);
    if (totalBytes < 1000) throw speechError("豆包语音没有返回有效音频，请检查服务额度后重试。", "doubao_empty_audio");
    return Buffer.concat(audio);
  } catch (error) {
    if (signal.aborted) throw speechError("豆包语音生成超时，请稍后重试。", "doubao_timeout", 504);
    if (error.code) throw error;
    throw speechError("无法连接豆包语音服务，请检查网络后重试。", "doubao_connection_failed");
  }
}
