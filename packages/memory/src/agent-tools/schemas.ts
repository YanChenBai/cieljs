import { Type } from "typebox";

export const memoryLayerSchema = Type.Union([Type.Literal("daily"), Type.Literal("long_term")]);

export const memoryKindSchema = Type.Union([
  Type.Literal("event"),
  Type.Literal("fact"),
  Type.Literal("preference"),
  Type.Literal("summary"),
]);

export const memoryDateSchema = Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" });
