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
    currentTopicNoQuestionPrompted: Boolean(state.currentTopicNoQuestionPrompted),
    messages: Array.isArray(state.messages) ? state.messages : [],
    errors: Array.isArray(state.errors) ? state.errors : [],
  };
}

function normalizeText(text = "") {
  return text
    .toString()
    .trim()
    .replace(/[。！？?!.，,]/g, "")
    .replace(/\s+/g, " ");
}

function isNoQuestion(text = "") {
  const clean = normalizeText(text).toLowerCase();
  return /^(没(?:有(?:了)?)?|没问题|没有问题|我没有问题|不用了|不用|不想问(?:了)?|问完了|不知道|没有了)$/i.test(clean);
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
  return /^(准备好了|好了|开始吧|可以|好|嗯|ready|yes)$/i.test(normalizeText(text));
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

/**
 * 识别用户最后一次明确的主题选择，处理纠正、多主题同时出现等情况。
 * 根据 Prompt 1.2 规则实现：
 * - "我想选主题1，不对，我想选主题2" → 主题2
 * - "主题12不对不对我想选主题2" → 主题2
 * - "不是主题一，是主题二" → 主题2
 * - "我不要遇水开花，我想看站立的牙签" → 主题2
 * - "我想选主题2，不对，还是主题1" → 主题1
 *
 * @param {string} text - 用户输入文本
 * @returns {string|null} - 最后确定的主题名称，或 null 如果没有明确纠正
 */
function extractTopicWithCorrection(text = "") {
  if (!text) return null;

  const clean = text.toLowerCase();

  // 纠正词汇列表：出现这些词意味着用户在纠正之前的选择
  const correctionMarkers = /不对|不是|说错了|换成|不要|还是|再想想|反正|其实|应该是|我要|我想选|我想看/gi;

  // 主题1的关键词集合
  const topic1Keywords = /主题\s*1|主题一|第一个|第1个|我选第一个|遇水开花|开花|花|纸花|水里的花/gi;

  // 主题2的关键词集合
  const topic2Keywords = /主题\s*2|主题二|第二个|第2个|我选第二个|站立的牙签|牙签|站起来|站立/gi;

  // 找出所有主题提及的位置和类型
  const mentions = [];

  let match;
  while ((match = topic1Keywords.exec(clean)) !== null) {
    mentions.push({ pos: match.index, len: match[0].length, topic: "遇水开花" });
  }
  while ((match = topic2Keywords.exec(clean)) !== null) {
    mentions.push({ pos: match.index, len: match[0].length, topic: "站立的牙签" });
  }

  // 找出所有纠正词的位置
  const corrections = [];
  while ((match = correctionMarkers.exec(clean)) !== null) {
    corrections.push({ pos: match.index, len: match[0].length });
  }

  // 如果没有任何主题提及，返回 null
  if (mentions.length === 0) return null;

  // 如果只有一个主题提及且没有纠正词，返回 null（不是纠正）
  if (mentions.length === 1 && corrections.length === 0) return null;

  // 如果有纠正词或多个主题提及，则返回最后一个主题
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

  const rawReply = answerMessage?.content || fallbackMessage?.content ||
    "小星刚刚没有听清楚，你可以再说一次吗？";

  return rawReply
    .replace(/\[(ADVANCE_TO_NEXT_TOPIC|END_ACTIVITY|ALL_TOPICS_DONE)\]/g, "")
    .trim();
}

async function handleExperimentFlow(state, userText, userId, chatHistory = []) {
  state = initExperimentState(state);
  const text = normalizeText(userText);

  if (state.phase === "waiting_ready") {
    if (isReady(text)) {
      state.phase = "waiting_name";
      return {
        reply: "好的！很高兴见到你！我是小星，你叫什么名字呢？",
        nextState: state,
      };
    }
    return {
      reply: "小朋友你好！让我们一起来进行科学探索吧！你准备好开始了吗～如果你准备好了，可以和我说‘准备好了’！",
      nextState: state,
    };
  }

  if (state.phase === "waiting_name") {
    if (!text) {
      return {
        reply: "请告诉我你的名字哦。",
        nextState: state,
      };
    }
    state.childName = parseName(text) || text;
    state.phase = "choosing_topic";
    return {
      reply: `${state.childName}你好！\n\n今天让我们一起来探索一些有趣的科学小现象吧！\n\n接下来我会分别给你播放两个科学小视频哦。每看完一个视频之后，你都可以提出任何和这个主题有关的问题。\n\n一共有两个视频主题：\n\n- 主题 1：遇水开花\n- 主题 2：站立的牙签\n\n你想先选哪个主题呢？`,
      nextState: state,
    };
  }

  if (state.phase === "choosing_topic") {    // 【优先级最高】检查主题纠正
    const correctedTopic = extractTopicWithCorrection(userText);
    if (correctedTopic && correctedTopic !== state.currentTopic) {
      // 用户纠正了主题选择
      state.currentTopic = correctedTopic;
      state.phase = "waiting_video_done";
      state.currentTopicNoQuestionPrompted = false;
      return {
        reply: `好的，那我们换成「${correctedTopic}」这个主题。视频播放结束后，请对我说'视频看完了'，然后我们就可以开始讨论啦！`,
        nextState: state,
      };
    }

    // 常规主题选择
    const topic = chooseTopic(text);
    if (!topic) {
      return {
        reply: `我还没听清你要哪个主题。${buildTopicListReply()}`,
        nextState: state,
      };
    }
    state.currentTopic = topic;
    state.phase = "waiting_video_done";
    state.currentTopicNoQuestionPrompted = false;
    return {
      reply: `太棒啦！我们先来看和「${topic}」有关的科学视频。视频播放结束后，请对我说‘视频看完了’，然后我们就可以开始讨论啦！`,
      nextState: state,
    };
  }

  if (state.phase === "waiting_video_done") {
    // 【优先级最高】检查主题纠正：用户可以在视频开始前改变主题选择
    const correctedTopic = extractTopicWithCorrection(userText);
    if (correctedTopic && correctedTopic !== state.currentTopic) {
      // 用户纠正了主题选择
      state.currentTopic = correctedTopic;
      state.currentTopicNoQuestionPrompted = false;
      return {
        reply: `好的，那我们换成「${correctedTopic}」这个主题。视频播放结束后，请对我说'视频看完了'，然后我们就可以开始讨论啦！`,
        nextState: state,
      };
    }

    // 检查用户是否确认视频看完
    if (isVideoDone(text)) {
      state.phase = "qa";
      state.currentTopicNoQuestionPrompted = false;
      return {
        reply: `视频是不是很有趣呀？关于这个主题，你有什么想问我的吗？你可以问任何和这个主题有关的问题哦。`,
        nextState: state,
      };
    }
    
    return {
      reply: `请看完视频后告诉我“视频看完了”。这样我才能回答你的问题。`,
      nextState: state,
    };
  }

  if (state.phase === "qa") {
    if (isNoQuestion(text) || isNextTopicIntent(text)) {
      if (!state.currentTopicNoQuestionPrompted && isNoQuestion(text)) {
        state.currentTopicNoQuestionPrompted = true;
        return {
          reply: "没关系，你可以提任何和刚刚的视频主题有关的问题。你还有问题吗？",
          nextState: state,
        };
      }

      state.completedTopics = [...new Set([...(state.completedTopics || []), state.currentTopic])];
      const nextTopic = chooseNextTopic(state);
      if (nextTopic) {
        state.currentTopic = nextTopic;
        state.currentTopicNoQuestionPrompted = false;
        state.phase = "waiting_video_done";
        return {
          reply: `好的！那我们接下来看看另一个主题：「${nextTopic}」。视频播放结束后，请对我说‘视频看完了’，然后我们就可以开始讨论啦！`,
          nextState: state,
        };
      }

      state.phase = "finished";
      return {
        reply: "今天我们已经一起探索了「遇水开花」和「站立的牙签」两个主题啦！你刚才提出的问题都很有意思，谢谢你和小星一起探索科学！",
        nextState: state,
      };
    }

    const reply = await callAIProvider({
      currentTopic: state.currentTopic,
      userQuestion: userText,
      conversationHistory: chatHistory,
      userId,
    });

    return {
      reply,
      nextState: state,
    };
  }

  if (state.phase === "finished") {
    return {
      reply: "活动已经结束了。你已经完成了今天的科学探索。",
      nextState: state,
    };
  }

  state.phase = "waiting_ready";
  return {
    reply: "小朋友你好！让我们一起来进行科学探索吧！你准备好开始了吗～如果你准备好了，可以和我说‘准备好了’！",
    nextState: state,
  };
}

app.post("/api/chat", async (req, res) => {
  try {
    const { childId, currentTopic, userQuestion, conversationHistory, state } = req.body;

    if (!childId || typeof childId !== "string") {
      return res.status(400).json({ error: "childId 不能为空" });
    }
    if (!userQuestion || typeof userQuestion !== "string") {
      return res.status(400).json({ error: "userQuestion 不能为空" });
    }

    const experimentState = initExperimentState(state || {});
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
      return res.status(500).json({
        error: "缺少 COZE_API_TOKEN，请检查 .env 文件。",
      });
    }

    if (!COZE_VOICE_ID) {
      return res.status(500).json({
        error: "缺少 COZE_VOICE_ID，请检查 .env 文件。",
      });
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
      return res.status(ttsResponse.status).json({
        error: "Coze TTS 失败：" + errorText,
      });
    }

    res.setHeader("Content-Type", contentType || "audio/mpeg");
    res.send(Buffer.from(arrayBuffer));
  } catch (error) {
    console.error("TTS server error:", error);
    res.status(500).json({
      error: error.message || "TTS 语音生成失败。",
    });
  }
});

app.post("/api/reset", (req, res) => {
  res.json({ ok: true });
});

// Ensure unknown /api/* routes always return JSON instead of HTML
app.use("/api", (req, res) => {
  res.status(404).json({
    error: `API route not found: ${req.method} ${req.originalUrl}`,
  });
});

app.use(express.static(publicPath));

// Fallback to index.html for other routes (static HTML hosting)
app.get("*", (req, res) => {
  res.sendFile(path.join(publicPath, "index.html"));
});

app.listen(port, () => {
  console.log(`小星聊天页面已启动：http://localhost:${port}`);
});