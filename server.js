import express from "express";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static("public"));

const COZE_API_TOKEN = process.env.COZE_API_TOKEN;
const COZE_BOT_ID = process.env.COZE_BOT_ID;
const COZE_USER_ID = process.env.COZE_USER_ID || "child_001";
const COZE_VOICE_ID = process.env.COZE_VOICE_ID || "7620288417930297386";

app.post("/api/chat", async (req, res) => {
  try {
    const userText = req.body.message;
    const userId = req.body.user_id || COZE_USER_ID || "test_user";

    console.log("收到用户输入：", userText);
    console.log("当前被试编号：", userId);

    if (!userText || typeof userText !== "string") {
      return res.status(400).json({ error: "message 不能为空" });
    }

    if (!COZE_API_TOKEN || !COZE_BOT_ID) {
      return res.status(500).json({
        error: "缺少 COZE_API_TOKEN 或 COZE_BOT_ID，请检查 .env 文件。",
      });
    }

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
            role: "user",
            content: userText,
            content_type: "text",
          },
        ],
      }),
    });

    const chatText = await chatResponse.text();
    console.log("Coze /v3/chat 原始返回：", chatText);

    let chatData;
    try {
      chatData = JSON.parse(chatText);
    } catch {
      return res.status(500).json({
        error: "Coze 返回的不是 JSON：" + chatText,
      });
    }

    if (!chatResponse.ok || chatData.code !== 0) {
      return res.status(500).json({
        error: chatData.msg || chatData.message || JSON.stringify(chatData),
      });
    }

    const conversationId = chatData.data?.conversation_id;
    const chatId = chatData.data?.id;

    if (!conversationId || !chatId) {
      return res.status(500).json({
        error:
          "Coze 返回中没有 conversation_id 或 chat_id：" +
          JSON.stringify(chatData),
      });
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
      console.log(`第 ${i + 1} 次 retrieve 返回：`, retrieveText);

      let retrieveData;
      try {
        retrieveData = JSON.parse(retrieveText);
      } catch {
        return res.status(500).json({
          error: "retrieve 返回的不是 JSON：" + retrieveText,
        });
      }

      if (!retrieveResponse.ok || retrieveData.code !== 0) {
        return res.status(500).json({
          error:
            retrieveData.msg ||
            retrieveData.message ||
            JSON.stringify(retrieveData),
        });
      }

      status = retrieveData.data?.status;
      console.log("当前状态：", status);

      if (status === "completed") {
        break;
      }

      if (
        status === "failed" ||
        status === "requires_action" ||
        status === "canceled"
      ) {
        return res.status(500).json({
          error:
            "Coze 对话异常结束，状态：" +
            status +
            "；详情：" +
            JSON.stringify(retrieveData),
        });
      }
    }

    if (status !== "completed") {
      return res.status(504).json({
        error: "Coze 回复超时，最后状态：" + status,
      });
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
    console.log("message/list 原始返回：", messagesText);

    let messagesData;
    try {
      messagesData = JSON.parse(messagesText);
    } catch {
      return res.status(500).json({
        error: "message/list 返回的不是 JSON：" + messagesText,
      });
    }

    if (!messagesResponse.ok || messagesData.code !== 0) {
      return res.status(500).json({
        error:
          messagesData.msg ||
          messagesData.message ||
          JSON.stringify(messagesData),
      });
    }

    const messages = messagesData.data || [];

    const answerMessage = messages
      .filter((msg) => msg.role === "assistant")
      .filter((msg) => msg.type === "answer")
      .pop();

    const fallbackMessage = messages
      .filter((msg) => msg.role === "assistant")
      .pop();

    const replyText =
      answerMessage?.content ||
      fallbackMessage?.content ||
      "小星刚刚没有听清楚，你可以再说一次吗？";

    console.log("最终回复：", replyText);

    res.json({
      reply: replyText,
    });
  } catch (error) {
    console.error("Server error:", error);
    res.status(500).json({
      error: error.message || "服务器出错。",
    });
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

app.listen(port, () => {
  console.log(`小星聊天页面已启动：http://localhost:${port}`);
});