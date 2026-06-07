部署说明 — Render（推荐）与 Vercel（静态）

概览
- 该项目包含前端静态页面（位于 `public`）和一个基于 Express 的后端（`server.js`）。后端调用外部 Coze API，需要设置私密环境变量。
- 推荐把完整项目（前端+后端）部署到 Render；如果只想托管静态前端，可使用 Vercel 或 GitHub Pages。

必需环境变量（在平台上创建）
- `COZE_API_TOKEN`：Coze API 的 Token（必需）。
- `COZE_BOT_ID`：Coze 上的 bot id（必需）。
- `COZE_USER_ID`：可选，默认 `child_001`。
- `COZE_VOICE_ID`：可选，默认已填一个示例值，用于 TTS。
- `PORT`：平台通常会自动提供；`server.js` 已使用 `process.env.PORT || 3000`。

在本地测试
1. 在项目根创建 `.env`，并填入上面的变量：
```
COZE_API_TOKEN=your_token_here
COZE_BOT_ID=your_bot_id_here
COZE_USER_ID=child_001
COZE_VOICE_ID=7620288417930297386
```
2. 安装依赖并启动：
```bash
npm install
npm start
```
3. 打开 http://localhost:3000

在 Render 部署（推荐，支持长期运行的 Node 服务）
1. 登录 https://render.com，选择 "New" → "Web Service"。
2. 连接你的 GitHub/GitLab 仓库并选择分支（例如 `main`）。
3. Build Command: `npm install`。Start Command: `node server.js`。
4. Environment: 选择 "Environment" → "Environment Variables"，添加上面的 `COZE_API_TOKEN`、`COZE_BOT_ID` 等变量。
5. 创建并等待自动部署，部署成功后 Render 会给你一个域名。

在 Vercel 部署（适合只托管静态前端，或把 API 改为 serverless）
- 该项目当前后端为 Express（长连接 / 监听 port），直接部署为 Vercel Serverless 会失败或需要改造。建议两种方式：
  - 仅部署静态前端：把 `public` 目录作为静态站点（下面给出 `vercel.json` 配置示例）。后端继续部署到 Render。
  - 把后端重构为 Vercel serverless 函数：将 `/api/chat`、`/api/tts`、`/api/reset` 分别改为 `api/chat.js`、`api/tts.js`、`api/reset.js`，返回符合 serverless handler 的格式（需要重写 `server.js` 的 Express 逻辑为函数）。

Vercel（静态前端）快速步骤：
1. 在 Vercel 控制面板新建项目，连接仓库。
2. 如果使用本仓库静态托管，请在项目设置里把 `public` 作为静态目录，或使用我们提供的 `vercel.json`。
3. 如果还需要后端 API，请把后端部署到 Render，并在前端把 API 地址改为完整域名（例如 `https://your-render-service.onrender.com/api/chat`）。

补充说明
- 我已把 `server.js` 修改为使用 `process.env.PORT || 3000`，以兼容平台分配的端口。参见 [server.js](server.js).
- 我在仓库中添加了 `render.yaml`（Render 的部署模板）和 `vercel.json`（用于静态前端托管的 Vercel 配置）。

如需我直接在仓库上：
- 帮你创建 Render 服务（生成 render.yaml 已完成），或者
- 把后端改为 Vercel serverless 函数（我可以开始改造 `server.js` 为 `/api/*.js` 函数）。

下一步请告诉我你要：
- 直接部署到 Render（我会进一步准备 render.yaml 并指导设置环境变量），或
- 只把前端静态部署到 Vercel（我会检查并提交 `vercel.json`），或
- 我现在就把后端改造为 Vercel serverless 函数。
