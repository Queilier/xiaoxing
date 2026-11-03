export function buildWarmupMessages(question, history = []) {
  return [
    { role: "system", content: "你是 AI 伙伴小星，正在和用户自由聊天。" },
    ...(Array.isArray(history) ? history : []).slice(-12)
      .filter(item => item && ["user", "assistant"].includes(item.role) && typeof item.text === "string")
      .map(item => ({ role: item.role, content: item.text.slice(0, 2000) })),
    { role: "user", content: question },
  ];
}
