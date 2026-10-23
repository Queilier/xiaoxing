import test from "node:test";
import assert from "node:assert/strict";
import { isReady, chooseTopic, extractTopicWithCorrection } from "../conversation-intents.js";

test("准备确认接受常见肯定说法、语气词和语音识别标点", () => {
  for (const text of ["准备好了", "准备好啦", "好啦", "好了", "可以了", "可以啦", "可以", "好", "好的", "开始吧", "我准备好了", "我已经准备好啦", "我们准备好了", "嗯嗯", "行啦", "没问题", "准备好啦！", "好 啦", "OK"]) {
    assert.equal(isReady(text), true, text);
  }
});

test("准备确认不会把否定、尚未准备好、询问和选题当作同意", () => {
  for (const text of ["", "没准备好", "我还没准备好", "还不可以", "不好", "准备好了吗", "等一下", "主题1", "1", "2"]) {
    assert.equal(isReady(text), false, text);
  }
});

test("带口头语或多个肯定短句的自然回复也能确认准备", () => {
  for (const text of ["嗯，准备好了。", "嗯嗯，我准备好啦！", "好的，我准备好了。", "嗯，可以了", "好啦，开始吧", "是的，我已经准备好了", "嗯，准备好了，我们开始吧", "准备好了呀", "嗯，我准备好了！", "嗯，嗯，准备好了"]) {
    assert.equal(isReady(text), true, text);
  }
});

test("口头语不能掩盖否定、等待或疑问", () => {
  for (const text of ["嗯，还没准备好", "好的，但我还没准备好", "嗯，不可以", "我没有准备好了", "嗯，准备好了吗？", "准备好了？还没有", "好了，等一下", "嗯，你准备好了吗", "嗯，我不知道", "嗯，我不想开始"]) {
    assert.equal(isReady(text), false, text);
  }
});

test("主题1接受数字、中文数字、编号和花水关键词", () => {
  for (const text of ["1", "１", "一", "一号", "主题1", "主题 1", "主题一", "第一个", "第1个", "我选1", "我选一", "遇水开花", "遇水", "开花", "花", "水", "纸花", "我想看花那个", "小星，我选1"]) {
    assert.equal(chooseTopic(text), "遇水开花", text);
  }
});

test("主题2接受数字、中文数字、编号和牙签五角星关键词", () => {
  for (const text of ["2", "２", "二", "二号", "主题2", "主题 2", "主题二", "第二个", "第2个", "我选2", "我选二", "牙签五角星", "牙签", "五角星", "星星", "星", "我要看五角星那个", "小星，我选2"]) {
    assert.equal(chooseTopic(text), "牙签五角星", text);
  }
});

test("无选择或同时提到两个主题时不擅自选择", () => {
  for (const text of ["", "好了", "小星", "小星你好", "星期一", "12", "主题12", "主题21", "1/2", "花和牙签都想看", "主题1还是主题2", "2026"]) {
    assert.equal(chooseTopic(text), null, text);
    assert.equal(extractTopicWithCorrection(text), null, text);
  }
});

test("纠正选题时同样支持简称和裸数字，以最后一次选择为准", () => {
  for (const [text, topic] of [
    ["1，不对，2", "牙签五角星"],
    ["二，不对，一", "遇水开花"],
    ["我想选主题1，不对，我想选主题2", "牙签五角星"],
    ["主题12不对不对，我想选主题2", "牙签五角星"],
    ["不是主题一，是主题二", "牙签五角星"],
    ["我不要遇水开花，我想看牙签五角星", "牙签五角星"],
    ["我想选2，不对，还是1", "遇水开花"],
    ["换成牙签", "牙签五角星"],
  ]) {
    assert.equal(extractTopicWithCorrection(text), topic, text);
  }
});
