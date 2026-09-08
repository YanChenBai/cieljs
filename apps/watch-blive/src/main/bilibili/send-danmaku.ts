import type { WebContents } from 'electron';
import Type from 'typebox';

import { executePage } from './page-executor';

export async function sendDanmaku(contents: WebContents, content: string) {
  const {
    response: { code, message, msg },
  } = await executePage(
    contents,
    `livePlayer.sendDanmaku({ msg: ${JSON.stringify(content)} })`,
    Type.Object({
      uniqueID: Type.Optional(Type.Any()),
      response: Type.Object({
        code: Type.Number(),
        data: Type.Optional(Type.Any()),
        message: Type.Optional(Type.String()),
        msg: Type.Optional(Type.String()),
      }),
    }),
  );

  return { accepted: code === 0, code, message: message ?? msg ?? '' };
}
