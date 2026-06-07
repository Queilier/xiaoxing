import express from "express";
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

const COZE_API_TOKEN = process.env.COZE_API_TOKEN;
const COZE_BOT_ID = process.env.COZE_BOT_ID;
const COZE_USER_ID = process.env.COZE_USER_ID || "child_001";
const COZE_VOICE_ID = process.env.COZE_VOICE_ID || "7620288417930297386";

const TOPICS = ["遇水开花", "站立的牙签"];
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
  return /^(准备好了|准备好|好了|开始吧|可以|好|嗯|ready|yes)$/i.test(normalizeText(text));
}

function chooseTopic(text = "") {
  const clean = normalizeText(text).toLowerCase();
  if (/(主题\s*1|主题一|第一个|第1个|我选第一个|遇水开花|开花|花|纸花|水里的花)/i.test(clean)) {
    return "遇水开花";
  }
  if (/(主题\s*2|主题二|第二个|第2个|我选第二个|站立的牙签|牙签|站起来|站立)/i.test(clean)) {
    return "站立的牙签";
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
  const topic2Keywords = /主题\s*2|主题二|第二个|第2个|我选第二个|站立的牙签|牙签|站起来|站立/gi;

  const mentions = [];

  let match;
  while ((match = topic1Keywords.exec(clean)) !== null) {
    mentions.push({ pos: match.index, len: match[0].length, topic: "遇水开花" });
  }
  while ((match = topic2Keywords.exec(clean)) !== null) {
    mentions.push({ pos: match.index, len: match[0].length, topic: "站立的牙签" });
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
  return `今天让我们一起来探索一些有趣的科学小现象吧！\n\n接下来我会分别给你播放两个科学小视频哦。每看完一个视频之后，你都可以提出任何和这个主题有关的问题。\n\n一共有两个视频主题：\n\n- 主题 1：遇水开花\n- 主题 2：站立的牙签\n\n你想先选哪个主题呢？`;
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

async function callAIProvider({ currentTopic, userQuestion, conversationHistory, userId }) {
  if (!COZE_API_TOKEN || !COZE_BOT_ID) {
    throw new Error("缺少 COZE_API_TOKEN 或 COZE_BOT_ID。请检查环境变量。");
  }

  const conversationText = formatConversationHistory(conversationHistory || []);
  const prompt = fillPromptTemplate(SCIENCE_ANSWER_PROMPT_TEMPLATE, {
    currentTopic,
    userQuestion,
    conversationHistory: conversationText,
  });

  const userMessage = [
    `childId: ${userId || "unknown"}`,
    `currentTopic: ${currentTopic || "未指定主题"}`,
    `userQuestion: ${userQuestion || ""}`,
    "conversationHistory:",
    conversationText || "无",
  ].join("\n\n");

  const chatResponse = await fetch("https://api.coze.cn/v3/chat", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${COZE_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      bot_id: COZE_BOT_ID,
      user_id: userId,
      stream: false,
      auto_save_history: true,
      additional_messages: [
        {
          role: "system",
          content: prompt,
          content_type: "text",
        },
        {
          role: "user",
          content: userMessage,
          content_type: "text",
        },
      ],
    }),
  });

  const chatText = await chatResponse.text();
  let chatData;
  try {
    chatData = JSON.parse(chatText);
  } catch {
    throw new Error("Coze 返回的不是 JSON：" + chatText);
  }

  if (!chatResponse.ok || chatData.code !== 0) {
    throw new Error(chatData.msg || chatData.message || JSON.stringify(chatData));
  }

  const conversationId = chatData.data?.conversation_id;
  const chatId = chatData.data?.id;

  if (!conversationId || !chatId) {
    throw new Error(
      "Coze 返回中没有 conversation_id 或 chat_id：" + JSON.stringify(chatData)
    );
  }

  let status = "created";
  for (let i = 0; i < 30; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const retrieveUrl = `https://api.coze.cn/v3/chat/retrieve?conversation_id=${conversationId}&chat_id=${chatId}`;
    const retrieveResponse = await fetch(retrieveUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${COZE_API_TOKEN}`,
        "Content-Type": "application/json",
      },
    });

    const retrieveText = await retrieveResponse.text();
    let retrieveData;
    try {
      retrieveData = JSON.parse(retrieveText);
    } catch {
      throw new Error("retrieve 返回的不是 JSON：" + retrieveText);
    }

    if (!retrieveResponse.ok || retrieveData.code !== 0) {
      throw new Error(
        retrieveData.msg || retrieveData.message || JSON.stringify(retrieveData)
      );
    }

    status = retrieveData.data?.status;
    if (status === "completed") {
      break;
    }

    if (status === "failed" || status === "requires_action" || status === "canceled") {
      throw new Error(
        "Coze 对话异常结束，状态：" + status + "；详情：" + JSON.stringify(retrieveData)
      );
    }
  }

  if (status !== "completed") {
    throw new Error("Coze 回复超时，最后状态：" + status);
  }

  const messageUrl = `https://api.coze.cn/v3/chat/message/list?conversation_id=${conversationId}&chat_id=${chatId}`;
  const messagesResponse = await fetch(messageUrl, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${COZE_API_TOKEN}`,
      "Content-Type": "application/json",
    },
  });

  const messagesText = await messagesResponse.text();
  let messagesData;
  try {
    messagesData = JSON.parse(messagesText);
  } catch {
    throw new Error("message/list 返回的不是 JSON：" + messagesText);
  }

  if (!messagesResponse.ok || messagesData.code !== 0) {
    throw new Error(
      messagesData.msg || messagesData.message || JSON.stringify(messagesData)
    );
  }

  const messages = messagesData.data || [];
  const answerMessage = messages
    .filter((msg) => msg.role === "assistant")
    .filter((msg) => msg.type === "answer")
    .pop();
  const fallbackMessage = messages
    .filter((msg) => msg.role === "assistant")
    .pop();

  const rawReply =
    answerMessage?.content ||
    fallbackMessage?.content ||
    "小星刚刚没有听清楚，你可以再说一次吗？";

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
        `一共有两个视频主题：\n\n- 主题 1：遇水开花\n- 主题 2：站立的牙签\n\n你想先选哪个主题呢？`,
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

app.post("/api/tts", async (req, res) => {
  try {
    const text = req.body.text;

    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "text 不能为空" });
    }

    if (!COZE_API_TOKEN) {
      return res.status(500).json({ error: "缺少 COZE_API_TOKEN，请检查 .env 文件。" });
    }

    if (!COZE_VOICE_ID) {
      return res.status(500).json({ error: "缺少 COZE_VOICE_ID，请检查 .env 文件。" });
    }

    console.log("准备生成语音，文本：", text);
    console.log("使用音色 ID：", COZE_VOICE_ID);

    const ttsResponse = await fetch("https://api.coze.cn/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${COZE_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: text,
        voice_id: COZE_VOICE_ID,
        response_format: "mp3",
      }),
    });

    const contentType = ttsResponse.headers.get("content-type") || "";
    const arrayBuffer = await ttsResponse.arrayBuffer();

    if (!ttsResponse.ok) {
      const errorText = Buffer.from(arrayBuffer).toString("utf-8");
      console.error("Coze TTS error:", errorText);
      return res.status(ttsResponse.status).json({ error: "Coze TTS 失败：" + errorText });
    }

    res.setHeader("Content-Type", contentType || "audio/mpeg");
    res.send(Buffer.from(arrayBuffer));
  } catch (error) {
    console.error("TTS server error:", error);
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