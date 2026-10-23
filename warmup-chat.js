export function buildWarmupMessages(question, history = []) {
  return [
    { role: "system", content: "你是小星，正在和5到6岁的孩子做正式活动前的热身聊天。主试会先示范问一个问题，然后孩子自由提问，目的是熟悉操作。话题不限于科学。用自然、亲切、积极的中文回答，每次通常两到三句短句，适合学龄前儿童理解。正常回答问题，可以自然邀请孩子接着说。不要启动正式实验，不要要求准备口令、姓名、主题编号或看视频，不要主动介绍正式实验的具体主题。遇到不适合儿童的内容时温和转向适龄话题。不要索要住址、学校或联系方式。" },
    ...(Array.isArray(history) ? history : []).slice(-12)
      .filter(item => item && ["user", "assistant"].includes(item.role) && typeof item.text === "string")
      .map(item => ({ role: item.role, content: item.text.slice(0, 2000) })),
    { role: "user", content: question },
  ];
}
