import { os, ORPCError } from "@orpc/server";
import * as z from "zod";
import type { TraceEntry } from "../protocol/index.ts";
import type { DevtoolsHost } from "./host.ts";

const page = z.object({
  cursor: z.number().int().nonnegative().optional(),
  limit: z.number().int().min(1).max(300).default(100),
});
const id = z.object({ id: z.string().min(1).max(200) });

export function createDevtoolsRouter(host: DevtoolsHost) {
  return {
    runs: {
      list: os
        .input(page)
        .handler(({ input }) =>
          host.store.list<TraceEntry>("run", { before: input.cursor, limit: input.limit }),
        ),
    },
    steps: {
      list: os
        .input(page)
        .handler(({ input }) =>
          host.store.list<TraceEntry>("step", { before: input.cursor, limit: input.limit }),
        ),
    },
    entries: {
      list: os.input(page.extend({ runId: z.string().optional() })).handler(({ input }) =>
        host.store.list<TraceEntry>("entry", {
          before: input.cursor,
          limit: input.limit,
          runId: input.runId,
        }),
      ),
      get: os.input(id).handler(({ input }) => {
        const entry = host.store.get<TraceEntry>(input.id);
        if (!entry) throw new ORPCError("NOT_FOUND");
        return entry;
      }),
    },
    messages: {
      get: os
        .input(z.object({ messageId: z.string().min(1).max(200) }))
        .handler(({ input }) => host.store.get<unknown>(`${input.messageId}:output`)),
    },
    values: {
      get: os
        .input(
          id.extend({
            path: z
              .array(
                z
                  .string()
                  .refine((key) => !["__proto__", "constructor", "prototype"].includes(key)),
              )
              .max(32)
              .optional(),
          }),
        )
        .handler(({ input }) => {
          let value = host.store.get<unknown>(input.id);
          for (const key of input.path ?? []) {
            if (!value || typeof value !== "object") throw new ORPCError("NOT_FOUND");
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor || !("value" in descriptor)) throw new ORPCError("NOT_FOUND");
            value = descriptor.value;
          }
          return value;
        }),
    },
    events: {
      subscribe: os
        .input(z.object({ afterSequence: z.number().int().nonnegative().optional() }))
        .handler(({ input, signal }) => host.events(input.afterSequence, signal)),
    },
    updates: os.handler(async function* ({ signal }) {
      let wake: (() => void) | undefined;
      let dirty = true;
      const changed = new Map<string, TraceEntry>();
      const steps = new Map<string, TraceEntry>();
      const notify = (update?: { entries: TraceEntry[]; steps?: TraceEntry[] }) => {
        for (const entry of update?.entries ?? []) changed.set(entry.id, entry);
        for (const step of update?.steps ?? []) steps.set(step.id, step);
        dirty = true;
        wake?.();
      };
      const unsubscribe = host.subscribe(notify);
      const abort = () => wake?.();
      signal?.addEventListener("abort", abort);
      try {
        yield {
          entries: host.store.list<TraceEntry>("entry", { limit: 300 }),
          steps: host.store.list<TraceEntry>("step", { limit: 300 }),
        };
        while (!signal?.aborted) {
          const pending = new Promise<void>((resolve) => {
            wake = resolve;
          });
          if (dirty) {
            dirty = false;
            const entries = [...changed.values()];
            changed.clear();
            const stepEntries = [...steps.values()];
            steps.clear();
            if (entries.length || stepEntries.length) yield { entries, steps: stepEntries };
          } else await pending;
        }
      } finally {
        unsubscribe();
        signal?.removeEventListener("abort", abort);
      }
    }),
  };
}

export type DevtoolsRouter = ReturnType<typeof createDevtoolsRouter>;
