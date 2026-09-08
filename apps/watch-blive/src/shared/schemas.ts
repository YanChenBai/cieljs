import { Type } from 'typebox';

export const PositiveIntegerSchema = Type.Integer({ minimum: 1 });

export const StartWatchSchema = Type.Object({
  mode: Type.Union([
    Type.Object({ type: Type.Literal('follow'), roomId: PositiveIntegerSchema }),
    Type.Object({ type: Type.Literal('explore'), areaId: PositiveIntegerSchema }),
    Type.Object({
      type: Type.Literal('recording'),
      roomId: PositiveIntegerSchema,
      source: Type.Union([
        Type.Object({ type: Type.Literal('url'), url: Type.String({ minLength: 1 }) }),
        Type.Object({ type: Type.Literal('file'), path: Type.String({ minLength: 1 }) }),
      ]),
      date: Type.Optional(Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })),
    }),
  ]),
  danmakuDelivery: Type.Optional(Type.Union([Type.Literal('simulate'), Type.Literal('live')])),
});

export const AccountSchema = Type.Object({
  uid: PositiveIntegerSchema,
  name: Type.String({ minLength: 1 }),
  face: Type.String(),
});

export const OptionalAccountSchema = Type.Union([AccountSchema, Type.Null()]);

export const LivePageReadinessSchema = Type.Object({
  roomId: Type.Union([PositiveIntegerSchema, Type.Null()]),
  ready: Type.Boolean(),
  canSendDanmaku: Type.Boolean(),
});

export const DanmakuPageResultSchema = Type.Object({
  accepted: Type.Boolean(),
  code: Type.Union([Type.Number(), Type.Null()]),
  message: Type.String(),
});
