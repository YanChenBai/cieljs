import type { WebContents } from 'electron';
import Type from 'typebox';

import { executePage } from './page-executor';

const RISK_CONTROL_KEYWORDS = [
  '风控',
  '风险',
  '频繁',
  '系统繁忙',
  '稍后再试',
  '安全校验',
  '验证码',
  '人机验证',
];

export async function sendDanmaku(contents: WebContents, roomId: number, content: string) {
  const response = await executePage(
    contents,
    createSendDanmakuScript(roomId, content),
    Type.Object({
      code: Type.Number(),
      data: Type.Optional(Type.Any()),
      message: Type.Optional(Type.String()),
      msg: Type.Optional(Type.String()),
    }),
  );

  const message = response.message || response.msg || '';
  const riskControl = isRiskControl(message);

  return {
    // 实测 code=0 也可能伴随风控文案（如 msg="f"），这种响应不代表弹幕真的播出。
    accepted: response.code === 0 && !riskControl,
    code: response.code,
    message,
    riskControl,
  };
}

/** 风控拦截的文案不固定，实测有 msg="f" 和直接写明风控两类，命中后都不应重试。 */
function isRiskControl(message: string) {
  return message === 'f' || RISK_CONTROL_KEYWORDS.some(keyword => message.includes(keyword));
}

/**
 * 直接向直播站自己的发送接口提交，不再经过播放器封装。
 *
 * 请求体对齐网页端：csrf 来自页面可读的 bili_jct，Cookie 和 Referer 由浏览器按当前页面
 * 自动带上，因此复用直播页的网络栈，而不是由主进程另发一份请求。
 */
function createSendDanmakuScript(roomId: number, content: string) {
  return `(async () => {
    const csrf = document.cookie.match(/(?:^|;\\s*)bili_jct=([^;]+)/u)?.[1];
    if (!csrf) throw new Error('缺少 bili_jct，无法发送弹幕');

    const body = new FormData();
    body.set('bubble', '0');
    body.set('color', '16777215');
    body.set('fontsize', '25');
    body.set('mode', '1');
    body.set('msg', ${JSON.stringify(content)});
    body.set('rnd', String(Math.floor(Date.now() / 1000)));
    body.set('roomid', '${roomId}');
    body.set('csrf_token', csrf);
    body.set('csrf', csrf);

    const response = await fetch('https://api.live.bilibili.com/msg/send', {
      method: 'POST',
      credentials: 'include',
      body,
    });

    return response.json();
  })()`;
}
