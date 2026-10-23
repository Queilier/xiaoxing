# 部署说明

项目包含静态网页和 Express 后端。聊天回答与语音识别使用 OpenAI；配音可选择豆包语音合成 2.0（邻家女孩 2.0）或 OpenAI。按住说话会录下短音频，松开后由 OpenAI `gpt-transcribe` 转成中文，再发送给小星。所有 API 密钥仅配置在本地 `.env` 或部署平台的服务端环境变量中。

## 本地运行

1. 在项目根目录创建 `.env`，参考 `.env.example` 设置 `OPENAI_API_KEY`。使用豆包配音时，另外填写 `DOUBAO_API_KEY` 并设置 `TTS_PROVIDER=doubao`。
2. 执行 `npm install` 和 `npm start`。
3. 打开 http://localhost:3000 。

网站首页是热身页。点击“正式开始”进入 `/activity`；主试也可以直接打开 `/activity` 进入原有正式流程。热身共用现有 OpenAI 识别与豆包配音配置，无需新增密钥。

可选环境变量：

- `TTS_PROVIDER`：`doubao` 使用邻家女孩 2.0；`openai` 使用 OpenAI 配音。没有设置时兼容原配置，使用 OpenAI。
- `DOUBAO_API_KEY`：豆包语音新版控制台的 API Key，需要开通语音合成 2.0，可先领取试用额度；与 OpenAI 密钥不同。
- `DOUBAO_TTS_VOICE`：默认 `zh_female_linjianvhai_uranus_bigtts`，对应邻家女孩 2.0。
- `OPENAI_CHAT_MODEL`：对话模型，默认 `gpt-5.6-terra`（较强且兼顾成本）；需要旗舰模型时可设为 `gpt-5.6-sol`。
- `OPENAI_TTS_MODEL`：语音合成模型，默认 `gpt-4o-mini-tts`。
- `OPENAI_TTS_VOICE`：语音音色，默认 `nova`，配合年轻女生、自然普通话的配音指令。
- `OPENAI_TRANSCRIPTION_MODEL`：语音识别模型，默认 `gpt-transcribe`。
- `PORT`：服务端口，默认 `3000`。

## Render 部署

创建 Node Web Service，Build Command 使用 `npm install`，Start Command 使用 `npm start`。在服务的 Environment Variables 中添加 `OPENAI_API_KEY`。使用豆包配音时，另外添加 `TTS_PROVIDER=doubao` 与 `DOUBAO_API_KEY`；Render 的 `render.yaml` 已预设邻家女孩 2.0。修改环境变量后需要重新启动或部署服务。

豆包 API Key 在 https://console.volcengine.com/speech/new/setting/apikeys 获取。调用的是语音合成 2.0（`seed-tts-2.0`），不需要购买声音复刻服务。密钥缺失、权限不足或额度不足时会显示错误，不会自动改用其他配音服务。

## 视频文件

把主题视频放进 `public/videos/`。当前页面配置的文件名见 `public/index.html`。
