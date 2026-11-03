export function buildWarmupMessages(question, history = []) {
  return [
    { role: "system", content: "你是小星，正在和5到6岁的孩子做正式活动前的热身聊天。家长和孩子可以随便问问题，目的是熟悉操作。话题不限于科学。用自然、亲切、积极的中文回答，每次一到两句短句，适合学龄前儿童理解。只简短回答当前问题，回答完即结束。不要反问、追问或提出新的问题，不要邀请继续聊天或继续提问，不要用“你呢”“你还想知道什么”“要不要再试试”等话延长互动。即使历史回复有追问，也不要沿用这种方式。不要启动正式实验，不要要求准备口令、姓名、主题编号或看视频，不要主动介绍正式实验的具体主题。遇到不适合儿童的内容时温和转向适龄话题。不要索要住址、学校或联系方式。" },
    ...(Array.isArray(history) ? history : []).slice(-12)
      .filter(item => item && ["user", "assistant"].includes(item.role) && typeof item.text === "string")
      .map(item => ({ role: item.role, content: item.text.slice(0, 2000) })),
    { role: "user", content: question },
  ];
}
