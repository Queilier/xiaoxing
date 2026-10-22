import express from "express";
import OpenAI, { toFile } from "openai";
import dotenv from "dotenv";
import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicPath = path.join(__dirname, "public");
const promptsPath = path.join(__dirname, "prompts");

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;
const OPENAI_CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || "gpt-5.6-terra";
const OPENAI_TTS_MODEL = process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
const OPENAI_TRANSCRIPTION_MODEL = process.env.OPENAI_TRANSCRIPTION_MODEL || "gpt-transcribe";
const OPENAI_TTS_VOICE = process.env.OPENAI_TTS_VOICE || "coral";

const TOPICS = ["遇水开花", "牙签五角星"];
const SCIENCE_ANSWER_PROMPT_TEMPLATE = await fs.readFile(
  path.join(promptsPath, "science-answer-prompt.md"),
  "utf-8"
);

function initExperimentState(state = {}) {
  return {
    phase: state.phase || "waiting_ready",
    childName: state.childName || null,
    currentTopic: state.currentTopic || null,
    completedTopics: Array.isArray(state.completedTopics) ? state.completedTopics : [],
    // per-topic flag map: whether we've already asked the follow-up for that topic
    noQuestionFollowUpUsed:
      typeof state.noQuestionFollowUpUsed === "object" && state.noQuestionFollowUpUsed !== null
        ? state.noQuestionFollowUpUsed
        : {},
    messages: Array.isArray(state.messages) ? state.messages : [],
    errors: Array.isArray(state.errors) ? state.errors : [],
  };
}

// FIX #1: When a new childId is passed that differs from the one embedded in
// the incoming state, return a fully-reset state instead of using the old one.
// This is enforced in the /api/chat handler below.

function normalizeText(text = "") {
  return text
    .toString()
    .trim()
    .replace(/[。！？?!.，,]/g, "")
    .replace(/\s+/g, " ");
}

function isNoQuestion(text = "") {
  const clean = normalizeText(text).toLowerCase();
  // FIX #6: tightened so short "好" / "可以了" / "好了" / "好啦" etc.
  // (which overlap with isVideoDone) are NOT matched here.
  // We only match expressions that genuinely mean "I have no questions".
  return /^(没(?:有(?:了)?)?问题(?:了)?|我没有问题|没有了|没了|没有想问(?:的)?|没想问的|不用了|不用|不想问(?:了)?|问完了|不知道(?:问什么)?|没有了|结束吧|结束(?:了)?|再见|今天到这里(?:吧)?|全部结束|活动结束|不想继续了|没有)$/i.test(
    clean
  );
}

function isNextTopicIntent(text = "") {
  const clean = normalizeText(text).toLowerCase();
  return /^(下一个吧|换一个|看另一个|我想看下一个|看下一个视频吧|下一个|换一(个|个主题)|再看一个)$/i.test(clean);
}

function isVideoDone(text = "") {
  const clean = normalizeText(text).toLowerCase();
  return /^(视频看完了|看完了|我看完了|好了|好啦|可以了|好|ok)$/i.test(clean);
}

function isReady(text = "") {
  return /^(准备好了|准备好|好了|好啦|开始吧|可以|好|嗯|ready|yes)$/i.test(normalizeText(text));
}

function chooseTopic(text = "") {
  const clean = normalizeText(text).toLowerCase();
  if (/(主题\s*1|主题一|第一个|第1个|我选第一个|遇水开花|开花|花|纸花|水里的花)/i.test(clean)) {
    return "遇水开花";
  }
  if (/(主题\s*2|主题二|第二个|第2个|我选第二个|牙签五角星|牙签|五角星|星)/i.test(clean)) {
    return "牙签五角星";
  }
  for (const topic of TOPICS) {
    if (clean.includes(topic)) return topic;
  }
  return null;
}

function chooseNextTopic(state) {
  const done = new Set(state.completedTopics || []);
  for (const topic of TOPICS) {
    if (!done.has(topic) && topic !== state.currentTopic) {
      return topic;
    }
  }
  return null;
}

function parseName(text = "") {
  const clean = normalizeText(text);
  const match = clean.match(/^(?:我叫|我是|叫我)?\s*(.+)$/);
  if (match && match[1]) {
    return match[1].replace(/[,，.!！?？]$/, "");
  }
  return clean || null;
}

function extractTopicWithCorrection(text = "") {
  if (!text) return null;

  const clean = text.toLowerCase();

  const correctionMarkers = /不对|不是|说错了|换成|不要|还是|再想想|反正|其实|应该是/gi;

  const topic1Keywords = /主题\s*1|主题一|第一个|第1个|我选第一个|遇水开花|开花|花|纸花|水里的花/gi;
  const topic2Keywords = /主题\s*2|主题二|第二个|第2个|我选第二个|牙签五角星|牙签|五角星|星/gi;

  const mentions = [];

  let match;
  while ((match = topic1Keywords.exec(clean)) !== null) {
    mentions.push({ pos: match.index, len: match[0].length, topic: "遇水开花" });
  }
  while ((match = topic2Keywords.exec(clean)) !== null) {
    mentions.push({ pos: match.index, len: match[0].length, topic: "牙签五角星" });
  }

  const corrections = [];
  while ((match = correctionMarkers.exec(clean)) !== null) {
    corrections.push({ pos: match.index, len: match[0].length });
  }

  if (mentions.length === 0) return null;

  if (mentions.length === 1 && corrections.length === 0) return null;

  if (mentions.length > 1 || corrections.length > 0) {
    const lastMention = mentions.reduce((latest, current) =>
      current.pos > latest.pos ? current : latest
    );
    return lastMention.topic;
  }

  return null;
}

function buildTopicListReply() {
  return `今天让我们一起来探索一些有趣的科学小现象吧！\n\n接下来我会分别给你播放两个科学小视频哦。每看完一个视频之后，你都可以提出任何和这个主题有关的问题。\n\n一共有两个视频主题：\n\n- 主题 1：遇水开花\n- 主题 2：牙签五角星\n\n你想先选哪个主题呢？`;
}

function formatConversationHistory(messages = []) {
  return messages
    .slice(-10)
    .map((item) => `[${item.role}] ${item.text}`)
    .join("\n");
}

function fillPromptTemplate(template, variables) {
  return template
    .replace(/{{\s*currentTopic\s*}}/g, variables.currentTopic || "")
    .replace(/{{\s*userQuestion\s*}}/g, variables.userQuestion || "")
    .replace(/{{\s*conversationHistory\s*}}/g, variables.conversationHistory || "");
}

async function callAIProvider({ currentTopic, userQuestion, conversationHistory }) {
  if (!openai) {
    throw new Error("缺少 OPENAI_API_KEY。请在 .env 或部署平台环境变量中配置 OpenAI API 密钥。");
  }

  const conversationText = formatConversationHistory(conversationHistory || []);
  const prompt = fillPromptTemplate(SCIENCE_ANSWER_PROMPT_TEMPLATE, {
    currentTopic,
    userQuestion,
    conversationHistory: conversationText,
  });

  const completion = await openai.chat.completions.create({
    model: OPENAI_CHAT_MODEL,
    messages: [{ role: "system", content: prompt }],
  });

  const rawReply = completion.choices?.[0]?.message?.content;
  if (!rawReply?.trim()) {
    throw new Error("OpenAI 没有返回有效的文字回复。");
  }

  return rawReply
    .replace(/\[(ADVANCE_TO_NEXT_TOPIC|END_ACTIVITY|ALL_TOPICS_DONE)\]/g, "")
    .trim();
}

// ─── FIXED RESULT CONSTANTS ─────────────────────────────────────────────────
const ENDING_REPLY =
  "恭喜小朋友！你已经成功完成了今天科学主题的探索！再见啦！";

const FOLLOWUP_REPLY =
  "没关系，你可以提任何和刚刚的视频主题有关的问题。你还有问题吗？";

// ─── MAIN FLOW ───────────────────────────────────────────────────────────────

async function handleExperimentFlow(state, userText, userId, chatHistory = []) {
  state = initExperimentState(state);
  const text = normalizeText(userText);

  // ── phase: waiting_ready ──────────────────────────────────────────────────
  if (state.phase === "waiting_ready") {
    if (isReady(text)) {
      state.phase = "waiting_name";
      return {
        reply: "好的！很高兴见到你！我是小星，你叫什么名字呢？",
        nextState: state,
      };
    }
    return {
      reply: "小朋友你好！让我们一起来进行科学探索吧！你准备好开始了吗～如果你准备好了，可以和我说'准备好了'！",
      nextState: state,
    };
  }

  // ── phase: waiting_name ───────────────────────────────────────────────────
  if (state.phase === "waiting_name") {
    if (!text) {
      return { reply: "请告诉我你的名字哦。", nextState: state };
    }
    state.childName = parseName(text) || text;
    state.phase = "choosing_topic";
    return {
      reply:
        `${state.childName}你好！\n\n今天让我们一起来探索一些有趣的科学小现象吧！\n\n` +
        `接下来我会分别给你播放两个科学小视频哦。每看完一个视频之后，你都可以提出任何和这个主题有关的问题。\n\n` +
        `一共有两个视频主题：\n\n- 主题 1：遇水开花\n- 主题 2：牙签五角星\n\n你想先选哪个主题呢？`,
      nextState: state,
    };
  }

  // ── phase: choosing_topic ─────────────────────────────────────────────────
  if (state.phase === "choosing_topic") {
    const correctedTopic = extractTopicWithCorrection(userText);
    if (correctedTopic && correctedTopic !== state.currentTopic) {
      state.currentTopic = correctedTopic;
      state.phase = "waiting_video_done";
      // FIX #7: initialise per-topic flag for the newly chosen topic
      state.noQuestionFollowUpUsed = state.noQuestionFollowUpUsed || {};
      state.noQuestionFollowUpUsed[correctedTopic] = false;
      return {
        reply: `好的，那我们换成「${correctedTopic}」这个主题。视频播放结束后，请对我说'视频看完了'，然后我们就可以开始讨论啦！`,
        nextState: state,
      };
    }

    const topic = chooseTopic(text);
    if (!topic) {
      return {
        reply: `我还没听清你要哪个主题。${buildTopicListReply()}`,
        nextState: state,
      };
    }
    state.currentTopic = topic;
    state.phase = "waiting_video_done";
    state.noQuestionFollowUpUsed = state.noQuestionFollowUpUsed || {};
    // FIX #7: always init to false for a freshly chosen topic
    state.noQuestionFollowUpUsed[topic] = false;
    return {
      reply: `太棒啦！我们先来看和「${topic}」有关的科学视频。视频播放结束后，请对我说'视频看完了'，然后我们就可以开始讨论啦！`,
      nextState: state,
    };
  }

  // ── phase: waiting_video_done ─────────────────────────────────────────────
  if (state.phase === "waiting_video_done") {
    const correctedTopic = extractTopicWithCorrection(userText);
    if (correctedTopic && correctedTopic !== state.currentTopic) {
      state.currentTopic = correctedTopic;
      state.noQuestionFollowUpUsed = state.noQuestionFollowUpUsed || {};
      // FIX #7: reset flag for the corrected topic
      state.noQuestionFollowUpUsed[correctedTopic] = false;
      return {
        reply: `好的，那我们换成「${correctedTopic}」这个主题。视频播放结束后，请对我说'视频看完了'，然后我们就可以开始讨论啦！`,
        nextState: state,
      };
    }

    if (isVideoDone(text)) {
      state.phase = "qa";
      state.noQuestionFollowUpUsed = state.noQuestionFollowUpUsed || {};
      // FIX #7: ensure flag exists (don't overwrite if already set for this topic)
      if (state.noQuestionFollowUpUsed[state.currentTopic] === undefined) {
        state.noQuestionFollowUpUsed[state.currentTopic] = false;
      }
      return {
        reply: `视频是不是很有趣呀？关于这个主题，你有什么想问我的吗？你可以问任何和这个主题有关的问题哦。`,
        nextState: state,
      };
    }

    return {
      reply: `请看完视频后告诉我"视频看完了"。这样我才能回答你的问题。`,
      nextState: state,
    };
  }

  // ── phase: qa ─────────────────────────────────────────────────────────────
  if (state.phase === "qa") {
    state.noQuestionFollowUpUsed = state.noQuestionFollowUpUsed || {};

    // FIX #6: in the qa phase, treat "视频看完了" etc. as a normal question,
    // NOT as "no question". isVideoDone inputs must fall through to callAIProvider
    // rather than being caught by the isNoQuestion / isNextTopicIntent branches.
    const looksLikeVideoDone = isVideoDone(text);

    if (!looksLikeVideoDone && (isNoQuestion(text) || isNextTopicIntent(text))) {
      // ── "下一个" shortcut ───────────────────────────────────────────────
      if (isNextTopicIntent(text)) {
        state.completedTopics = [...new Set([...(state.completedTopics || []), state.currentTopic])];
        const nextTopic = chooseNextTopic(state);
        if (nextTopic) {
          state.currentTopic = nextTopic;
          // FIX #7: init flag for new topic
          state.noQuestionFollowUpUsed[nextTopic] = false;
          state.phase = "waiting_video_done";
          return {
            reply: `好的！那我们接下来看看另一个主题：「${nextTopic}」。视频播放结束后，请对我说'视频看完了'，然后我们就可以开始讨论啦！`,
            nextState: state,
          };
        }
        state.phase = "finished";
        return { reply: ENDING_REPLY, nextState: state };
      }

      // ── "没有问题" branch ───────────────────────────────────────────────
      const followUpUsedForThisTopic = Boolean(
        state.noQuestionFollowUpUsed[state.currentTopic]
      );

      if (!followUpUsedForThisTopic) {
        // FIX #4 & #5: first time — ask the follow-up question and mark it used
        state.noQuestionFollowUpUsed[state.currentTopic] = true;
        return { reply: FOLLOWUP_REPLY, nextState: state };
      }

      // Second time saying no-question for this topic → advance
      // FIX #3: mark topic complete BEFORE checking whether both are done
      state.completedTopics = [
        ...new Set([...(state.completedTopics || []), state.currentTopic]),
      ];

      const nextTopic = chooseNextTopic(state);
      if (nextTopic) {
        state.currentTopic = nextTopic;
        // FIX #7: init flag for the next topic
        state.noQuestionFollowUpUsed[nextTopic] = false;
        state.phase = "waiting_video_done";
        return {
          reply: `好的！那我们接下来看看另一个主题：「${nextTopic}」。视频播放结束后，请对我说'视频看完了'，然后我们就可以开始讨论啦！`,
          nextState: state,
        };
      }

      // FIX #3: no more topics → output ending (not skip-to-end prematurely)
      state.phase = "finished";
      return { reply: ENDING_REPLY, nextState: state };
    }

    // ── normal question (or "视频看完了" treated as a message) ─────────────
    const reply = await callAIProvider({
      currentTopic: state.currentTopic,
      userQuestion: userText,
      conversationHistory: chatHistory,
      userId,
    });

    return { reply, nextState: state };
  }

  // ── phase: finished ───────────────────────────────────────────────────────
  if (state.phase === "finished") {
    return { reply: ENDING_REPLY, nextState: state };
  }

  // Fallback
  state.phase = "waiting_ready";
  return {
    reply: "小朋友你好！让我们一起来进行科学探索吧！你准备好开始了吗～如果你准备好了，可以和我说'准备好了'！",
    nextState: state,
  };
}

// ─── API ROUTES ───────────────────────────────────────────────────────────────

app.post("/api/chat", async (req, res) => {
  try {
    const { childId, currentTopic, userQuestion, conversationHistory, state } = req.body;

    if (!childId || typeof childId !== "string") {
      return res.status(400).json({ error: "childId 不能为空" });
    }
    if (!userQuestion || typeof userQuestion !== "string") {
      return res.status(400).json({ error: "userQuestion 不能为空" });
    }

    // FIX #1: if the incoming state belongs to a different child, start fresh.
    // The frontend stores childId inside experimentData but doesn't yet embed it
    // inside the state object itself; we add a lightweight check here so the
    // server is always the authoritative guard.
    let experimentState;
    const incomingStateChildId = state?.childId || null;
    if (incomingStateChildId && incomingStateChildId !== childId) {
      // Different child — ignore stale state entirely
      experimentState = initExperimentState({});
    } else {
      experimentState = initExperimentState(state || {});
      // Stamp the childId so future requests can detect mismatches
      experimentState.childId = childId;
    }

    if (typeof currentTopic === "string" && currentTopic) {
      experimentState.currentTopic = currentTopic;
    }

    const chatHistoryArray = Array.isArray(conversationHistory) ? conversationHistory : [];
    const result = await handleExperimentFlow(
      experimentState,
      userQuestion,
      childId,
      chatHistoryArray
    );

    // Always stamp childId on the returned state so subsequent requests can
    // detect child-ID mismatches reliably.
    result.nextState.childId = childId;

    res.json({ ok: true, reply: result.reply, nextState: result.nextState });
  } catch (error) {
    console.error("/api/chat error:", error);
    res.status(500).json({ error: error.message || "聊天服务出错了" });
  }
});

app.post(
  "/api/transcribe",
  express.raw({
    type: ["audio/webm", "audio/mp4", "audio/mpeg", "audio/wav", "audio/x-m4a"],
    limit: "25mb",
  }),
  async (req, res) => {
    try {
      if (!openai) {
        return res.status(500).json({
          error: "缺少 OPENAI_API_KEY。请在 .env 或部署平台环境变量中配置 OpenAI API 密钥。",
        });
      }
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({ error: "没有收到录音，请再按住说一次。" });
      }

      const contentType = (req.get("content-type") || "audio/webm").split(";")[0];
      const extensionByType = {
        "audio/webm": "webm",
        "audio/mp4": "mp4",
        "audio/mpeg": "mp3",
        "audio/wav": "wav",
        "audio/x-m4a": "m4a",
      };
      const extension = extensionByType[contentType];
      if (!extension) {
        return res.status(415).json({ error: "当前浏览器录音格式暂不支持，请改用文字输入。" });
      }

      const transcription = await openai.audio.transcriptions.create({
        file: await toFile(req.body, `child-question.${extension}`, { type: contentType }),
        model: OPENAI_TRANSCRIPTION_MODEL,
        languages: ["zh-cn"],
        prompt: "这是 5 到 6 岁儿童关于科学视频的中文对话。主题词包括：遇水开花、牙签五角星。请准确转写听到的原话，不要补充内容。",
        response_format: "json",
      });

      res.json({ ok: true, text: transcription.text || "" });
    } catch (error) {
      console.error("OpenAI transcription error:", error);
      res.status(500).json({ error: error.message || "语音识别失败，请再试一次或直接打字。" });
    }
  }
);

app.post("/api/tts", async (req, res) => {
  try {
    const text = req.body.text;

    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "text 不能为空" });
    }

    if (!openai) {
      return res.status(500).json({
        error: "缺少 OPENAI_API_KEY。请在 .env 或部署平台环境变量中配置 OpenAI API 密钥。",
      });
    }

    const speech = await openai.audio.speech.create({
      model: OPENAI_TTS_MODEL,
      voice: OPENAI_TTS_VOICE,
      input: text,
      instructions: "请用普通话，以亲切、清晰、自然的语气和 5 到 6 岁的小朋友说话。语速稍慢，发音清楚。",
      response_format: "mp3",
    });

    const audioBuffer = Buffer.from(await speech.arrayBuffer());
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");
    res.send(audioBuffer);
  } catch (error) {
    console.error("OpenAI TTS error:", error);
    res.status(500).json({ error: error.message || "TTS 语音生成失败。" });
  }
});

app.post("/api/reset", (req, res) => {
  try {
    const nextState = initExperimentState();
    res.json({ ok: true, nextState });
  } catch (err) {
    console.error("/api/reset error:", err);
    res.status(500).json({ ok: false, error: err.message || "reset failed" });
  }
});

// Ensure unknown /api/* routes always return JSON instead of HTML
app.use("/api", (req, res) => {
  res.status(404).json({
    error: `API route not found: ${req.method} ${req.originalUrl}`,
  });
});

app.use(express.static(publicPath));

app.get("*", (req, res) => {
  res.sendFile(path.join(publicPath, "index.html"));
});

app.listen(port, () => {
  console.log(`小星聊天页面已启动：http://localhost:${port}`);
});