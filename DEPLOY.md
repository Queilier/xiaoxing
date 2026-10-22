# 部署说明

项目包含静态网页和 Express 后端。聊天回答和语音合成通过后端调用 OpenAI API；按住说话会录下短音频，松开后由 OpenAI `gpt-transcribe` 转成中文，再发送给小星。OpenAI API 密钥只配置在本地 `.env` 或托管平台的服务端环境变量中，不要放进网页代码或提交到仓库。

## 本地运行

1. 在项目根目录创建 `.env`，参考 `.env.example` 设置 `OPENAI_API_KEY`。
2. 执行 `npm install` 和 `npm start`。
3. 打开 http://localhost:3000 。

可选环境变量：

- `OPENAI_CHAT_MODEL`：对话模型，默认 `gpt-5.6-terra`（较强且兼顾成本）；需要旗舰模型时可设为 `gpt-5.6-sol`。
- `OPENAI_TTS_MODEL`：语音合成模型，默认 `gpt-4o-mini-tts`。
- `OPENAI_TTS_VOICE`：语音音色，默认 `coral`。
- `OPENAI_TRANSCRIPTION_MODEL`：语音识别模型，默认 `gpt-transcribe`。
- `PORT`：服务端口，默认 `3000`。

## Render 部署

创建 Node Web Service，Build Command 使用 `npm install`，Start Command 使用 `npm start`。在服务的 Environment Variables 中添加 `OPENAI_API_KEY`；其余模型和音色设置可选。部署后，语音与聊天请求都会由该服务端转发到 OpenAI。

## 视频文件

把主题视频放进 `public/videos/`。当前页面配置的文件名见 `public/index.html`。
