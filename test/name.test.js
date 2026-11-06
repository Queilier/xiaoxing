import test from 'node:test';
import assert from 'node:assert/strict';
import { parseName } from '../conversation-intents.js';
test('姓名去掉自我介绍、口头语及句末标点', () => {
  for (const input of ['呃，我叫小张。', '嗯嗯，我的名字是小张。', '额我叫小张', '我叫小张。', '叫我小张！', '我是小张', '我的名字叫小张', '小张。']) assert.equal(parseName(input), '小张', input);
});
test('保留昵称和外文姓名，不把犹豫或未完成介绍作为姓名', () => {
  for (const name of ['阿呆', '小嗯', '张三', 'Mary Jane']) assert.equal(parseName(name), name);
  for (const input of ['', '呃。', '嗯嗯', '我叫', '呃，我叫。']) assert.equal(parseName(input), null, input);
});
