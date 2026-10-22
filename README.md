# 小星科学探索

## 添加主题视频

将 MP4 视频放入 `public/videos/`，使用以下文件名，网页播放器会按当前科学主题自动切换：

- `遇水开花.MP4`
- `牙签五角星.mov`

启动项目后，选择主题即可在左侧播放视频。视频播完后，右侧聊天会自动进入提问环节。手机和平板上视频区会显示在聊天区上方。

## 本地启动

```bash
npm install
npm start
```

然后打开 http://localhost:3000 。聊天和识别需要在 `.env` 中配置 `OPENAI_API_KEY`，并确保 OpenAI API 账户有可用额度。配音现支持豆包的“邻家女孩 2.0”：设置 `TTS_PROVIDER=doubao` 并填写 `DOUBAO_API_KEY`，示例见 `.env.example`。具体部署方式见 [DEPLOY.md](DEPLOY.md)。

macOS 本地服务会自动使用系统设置中的 HTTPS 代理。也可以通过 `OPENAI_PROXY_URL` 手动指定代理地址，或设为 `direct` 禁用代理；Render 等云端默认直连。修改网络设置后需要重启服务。
