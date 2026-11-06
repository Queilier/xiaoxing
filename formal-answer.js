export const QUESTION_FOLLOWUP = '你还有什么好奇的地方嘛？';

export function buildFormalMessages(systemPrompt, currentTopic, question, history = []) {
  return [
    { role: 'system', content: systemPrompt.trim() + (currentTopic ? `\n当前视频主题：${currentTopic}` : '') },
    ...(Array.isArray(history) ? history : []).slice(-10)
      .filter(item => item && ['user', 'assistant'].includes(item.role) && typeof item.text === 'string')
      .map(item => ({ role: item.role, content: item.text })),
    { role: 'user', content: question },
  ];
}

export function finishFormalAnswer(rawReply) {
  if (typeof rawReply !== 'string' || !rawReply.trim()) throw new Error('OpenAI 没有返回有效的文字回复。');
  let answer = rawReply.replace(/\[(ADVANCE_TO_NEXT_TOPIC|END_ACTIVITY|ALL_TOPICS_DONE)\]/g, '').trim();
  // Add the exact follow-up in code, avoiding dependence on model compliance.
  while (answer.endsWith(QUESTION_FOLLOWUP)) answer = answer.slice(0, -QUESTION_FOLLOWUP.length).trimEnd();
  return answer ? `${answer}\n\n${QUESTION_FOLLOWUP}` : QUESTION_FOLLOWUP;
}
