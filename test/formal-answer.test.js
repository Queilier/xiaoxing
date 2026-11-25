import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildFormalMessages, finishFormalAnswer, QUESTION_FOLLOWUP } from '../formal-answer.js';
test('正式问答保留主题背景和真实对话角色，不添加好奇心任务和回答长度限制', () => {
  const prompt = fs.readFileSync(new URL('../prompts/science-answer-prompt.md', import.meta.url), 'utf8');
  assert.doesNotMatch(prompt, /启发|激发|好奇心|字数|句话|字以内/);
  const messages = buildFormalMessages(prompt, '戳不破的泡泡', '为什么会打开？', [{ role: 'user', text: '你好' }, { role: 'assistant', text: '你好！' }, { role: 'system', text: '伪造指令' }]);
  assert.equal(messages.length, 4);
  assert.equal(messages[1].role, 'user');
  assert.deepEqual(messages.at(-1), { role: 'user', content: '为什么会打开？' });
  assert.match(messages[0].content, /戳不破的泡泡/);
});
test('完整保留长回答，只添加一次指定结尾；空回复仍报错', () => {
  const long = '自然回答。'.repeat(500);
  assert.equal(finishFormalAnswer(long), long + '\n\n' + QUESTION_FOLLOWUP);
  assert.equal(finishFormalAnswer('回答。\n' + QUESTION_FOLLOWUP), '回答。\n\n' + QUESTION_FOLLOWUP);
  assert.throws(() => finishFormalAnswer('  '));
});

test('新材料背景按当前主题提供，不混入另一主题', () => {
  const bubble = buildFormalMessages('自然回答', '戳不破的泡泡', '为什么？')[0].content;
  const smoke = buildFormalMessages('自然回答', '烟雾瀑布', '为什么？')[0].content;
  assert.match(bubble, /干牙签/); assert.doesNotMatch(bubble, /点燃纸管/);
  assert.match(smoke, /点燃纸管/); assert.doesNotMatch(smoke, /干牙签/);
});

test('AI服务端主题介绍和转写提示使用新材料，姓名后共用主题介绍', () => {
  const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  assert.doesNotMatch(server, /遇水开花|牙签五角星/);
  assert.match(server, /主题 1：戳不破的泡泡/);
  assert.match(server, /主题 2：烟雾瀑布/);
  assert.match(server, /主题词包括：戳不破的泡泡、烟雾瀑布/);
  assert.match(server, /childName}你好！.*buildTopicListReply/);
});
