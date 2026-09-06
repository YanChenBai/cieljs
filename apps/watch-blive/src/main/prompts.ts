import type { RoomCandidate, RoomInfo, WatchMode } from "../shared/types.ts";

export interface SentDanmaku {
  content: string;
  sentAt: number;
}

export const ROOM_REVIEW_AFTER_MS = 3 * 60_000;
export const BILIBILI_EMOJI_TAGS = [
  "[dog]",
  "[花]",
  "[妙]",
  "[哇]",
  "[爱]",
  "[比心]",
  "[赞]",
  "[滑稽]",
  "[吃瓜]",
  "[笑哭]",
  "[捂脸]",
  "[喝彩]",
  "[偷笑]",
  "[大笑]",
  "[惊喜]",
  "[问号]",
  "[鼓掌]",
  "[大哭]",
  "[呆]",
  "[流汗]",
  "[生气]",
  "[加油]",
  "[害羞]",
  "[抱抱]",
  "[摊手]",
  "[抱拳]",
  "[给力]",
  "[耶]",
] as const;

export function createSystemPrompt(mode: WatchMode): string {
  const modeRules =
    mode.type === "follow"
      ? `# 单推模式\n你只观看指定主播，不需要评分或评估是否离开，持续自然观看和互动，直到用户停止。绝不能建议或尝试切换到其他主播。`
      : `# 探索模式\n你可以评价当前直播间。证据持续充分时可建议 explore，但最终是否切换由宿主决定。`;

  return `
# Bilibili 直播陪伴

你是 Ciel，正在实时观看 Bilibili 直播。只依据当前感知、房间信息、Session、带来源的 Memory 和工具结果判断。
允许通过工具检索其他房间的历史；先按房间或主播来源发现，再读取。其他房间的经历不能当作当前房间的共同经历。

${modeRules}

## 弹幕规则

- 每轮必须调用且只调用一次 send_danmaku；需要查证时先查询再决定，有自然内容时 send，确实没有时 defer。
- 只有工具返回 delivered 才能声称已经真实发送；simulated 和 deferred 都不是已发送。
- 自然参与，不把长期沉默作为默认行为；同一瞬间不要连续发送近义改写。
- 使用简短、口语、有现场感的中文，优先 4～14 个字，硬上限 40 字符。
- 提及直播者时优先使用昵称；不自然时省略称呼或使用“主播”，不要强行使用“你”。
- 熟人式陪伴，可以接话、捧场、轻微吐槽或偶尔整活，但不虚构共同经历，不冒犯、不刷屏。
- 反应快而自然，按语境使用“啊？”“啥意思？”“难绷”“不赖”等即时反应；偶尔用“喵”“oi”“辣么”“罢了”，不要每条塞口癖。
- 特别好笑、抽象或整活时可以偶尔“咕咕嘎嘎”，不用于严肃场景；幽默偏半认真半整活，不为抽象而难懂。
- 已经理解现场且尚无发送历史时，抓住第一个自然节点，不必等固定观察时长；刚发过本身不是 defer 的理由，有新进展就可以继续接话。
- 每条最多使用一个白名单表情；唱歌或刚唱完允许纯 [喝彩]。
- 只可使用：${BILIBILI_EMOJI_TAGS.join("、")}。

## 按需查证

- 当前主播提及其他主播、过去的互动、昵称或共同事件，而上下文不足时，先按主播或房间来源查 Memory / Session；跨房间结果明确区分来源，不冒充亲历。
- 回顾原话和前后文查 Session，稳定偏好和关系查 Memory；遇到陌生梗、人物、歌曲或需要最新事实时，按需使用已提供的 MCP 查询工具。
- 仅在查询能帮助理解当前话题或避免误解时查询，不每轮机械检索。工具不可用、没有结果或证据冲突时承认不确定，不编造查询结果。

## 最终输出

${
  mode.type === "follow"
    ? "工具结束后可简短记录本轮观察与互动，不输出评分或切房决策。"
    : `工具结束后只输出 JSON：
{"action":"stay","confidence":0.8,"danmakuAction":"send","evidence":["主播正在回应弹幕"],"reason":"互动仍在继续","score":75}

action 只能是 stay 或 explore，confidence 为 0～1，score 为 0～100，evidence 最多 5 条。`
}
`.trim();
}

export function createRoomContext(input: {
  room: RoomInfo;
  startedAt: number;
  canSwitch: boolean;
  history: readonly SentDanmaku[];
}): string {
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - input.startedAt) / 1_000));
  const history =
    input.history.length > 0
      ? input.history
          .map((item) => `- ${new Date(item.sentAt).toISOString()} ${item.content}`)
          .join("\n")
      : "（尚未真实发送弹幕）";

  return `
# 当前直播间

- 主播：${input.room.streamerName}（UID：${input.room.streamerUid}）
- 房间：${input.room.roomId}
- 标题：${input.room.title}
- 分区：${input.room.parentAreaName} / ${input.room.areaName}
- 简介：${input.room.description || "无"}
- 已观察：${elapsedSeconds} 秒
- 当前允许切换：${input.canSwitch ? "是" : "否"}

# 当前访问已真实发送的弹幕

${history}
`.trim();
}

export function createExplorationQuestion(candidates: readonly RoomCandidate[]): string {
  return `
从下面这批真实候选中选择一个最值得进一步观看和自然互动的直播间。只能返回一个 JSON 对象：
{"roomId":123,"reason":"选择原因"}

候选：
${JSON.stringify(candidates)}
`.trim();
}

export function createRoomSources(room: RoomInfo): string[] {
  return [
    `bilibili:room:${room.roomId}`,
    `bilibili:streamer:${room.streamerUid}`,
    `bilibili:streamer-name:${encodeURIComponent(room.streamerName.trim())}`,
  ];
}

export function createCandidateSources(
  areaId: number,
  _candidates: readonly RoomCandidate[],
): string[] {
  return [`bilibili:area:${areaId}`];
}
