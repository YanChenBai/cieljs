import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";

export const RoomSelectionSchema = Type.Object({
  roomId: Type.Integer({ minimum: 1 }),
  reason: Type.String({ minLength: 1, maxLength: 160 }),
});

export const RoomDecisionSchema = Type.Object({
  action: Type.Union([Type.Literal("stay"), Type.Literal("explore")]),
  confidence: Type.Number({ minimum: 0, maximum: 1 }),
  danmakuAction: Type.Union([Type.Literal("send"), Type.Literal("defer")]),
  evidence: Type.Array(Type.String(), { maxItems: 5 }),
  reason: Type.String({ minLength: 1, maxLength: 240 }),
  score: Type.Number({ minimum: 0, maximum: 100 }),
});

export type RoomSelection = Static<typeof RoomSelectionSchema>;
export type RoomDecision = Static<typeof RoomDecisionSchema>;

export function parseDecision<T extends TSchema>(text: string, schema: T): Static<T> {
  const normalized = text.trim();
  const blocks = [...normalized.matchAll(/```(?:json)?\s*\n?([\s\S]*?)```/giu)];
  if (blocks.length > 1) throw new Error("Agent 输出包含多个决策 JSON，无法确定最终选择");
  const content = blocks.length === 1 ? blocks[0]![1]!.trim() : normalized;
  try {
    return Value.Parse(schema, JSON.parse(content));
  } catch (error) {
    throw new Error("Agent 输出不是有效的决策 JSON", { cause: error });
  }
}
