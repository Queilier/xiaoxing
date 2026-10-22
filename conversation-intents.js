export function normalizeText(text = "") {
  return text.toString().normalize("NFKC").trim()
    .replace(/[。！？?!.，,]/g, "")
    .replace(/\s+/g, " ");
}

// 仅在等待准备确认的阶段调用，不能把否定或疑问句当作同意。
export function isReady(text = "") {
  const clean = normalizeText(text).replace(/[\s~～]/g, "");
  return /^(?:(?:我|我们)?(?:已经|都)?准备好(?:了|啦|呀|啊|喽|咯)?|好(?:了|啦|的|呀|啊|吧)?|(?:我)?可以(?:了|啦|呀|啊|吧|开始(?:了|啦)?)?|行(?:了|啦|呀|啊)?|没问题|(?:我们)?开始(?:吧|啦|了)?|嗯(?:嗯|哼)?|ready|yes|ok)$/i.test(clean);
}

const rules = [
  {
    topic: "遇水开花",
    pattern: /遇水开花|纸花|开花|遇水|花|水|主题\s*(?:1(?!\d)|一(?![二三四五六七八九十百千万]))|第\s*(?:1(?!\d)|一)\s*个|(?<![\dA-Za-z.])1(?![\dA-Za-z.])|(?:^|[，,。.!！?？、\s/])一(?:号|个)?(?=$|[，,。.!！?？、\s/])|(?:选(?:择)?|看|要|换成|改成)\s*一(?:号|个)?(?:吧|呀|啊|啦|哦)?(?=$|[，,。.!！?？、\s/])/gi,
  },
  {
    topic: "牙签五角星",
    pattern: /牙签五角星|牙签|五角星|星星|(?<!小)星(?!期)|主题\s*(?:2(?!\d)|二(?![一三四五六七八九十百千万]))|第\s*(?:2(?!\d)|二)\s*个|(?<![\dA-Za-z.])2(?![\dA-Za-z.])|(?:^|[，,。.!！?？、\s/])二(?:号|个)?(?=$|[，,。.!！?？、\s/])|(?:选(?:择)?|看|要|换成|改成)\s*二(?:号|个)?(?:吧|呀|啊|啦|哦)?(?=$|[，,。.!！?？、\s/])/gi,
  },
];

function topicMentions(text) {
  const clean = text.toString().normalize("NFKC").toLowerCase();
  return rules.flatMap(({ topic, pattern }) =>
    [...clean.matchAll(pattern)].map((match) => ({ topic, pos: match.index }))
  ).sort((a, b) => a.pos - b.pos);
}

export function chooseTopic(text = "") {
  const topics = new Set(topicMentions(text).map(({ topic }) => topic));
  // 同时提到两个主题而未说明改选时，请孩子澄清。
  return topics.size === 1 ? [...topics][0] : null;
}

export function extractTopicWithCorrection(text = "") {
  // “主题1还是主题2”是询问；“不对，还是2”或“还是选2”才是改选。
  const correction = /不对|不是|说错了|换成|改成|不要|再想想|反正|其实|应该是|(?:^|[，,。])\s*(?:我)?还是/i;
  if (!correction.test(text)) return null;
  const mentions = topicMentions(text);
  return mentions.at(-1)?.topic || null;
}
