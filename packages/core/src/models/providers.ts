import { createProvider, envApiKeyAuth, type Model } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/compat";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";

const mimo: Model<"openai-completions"> = {
  id: "mimo-v2.5",
  name: "MiMo-V2.5",

  provider: "xiaomi",
  api: "openai-completions",
  baseUrl: "https://api.xiaomimimo.com/v1",

  reasoning: true,
  input: ["text", "image"],

  thinkingLevelMap: {
    off: "none",
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: null,
  },

  contextWindow: 262_144,
  maxTokens: 131_072,

  cost: {
    input: 0.4,
    output: 2,
    cacheRead: 0,
    cacheWrite: 0,
  },

  compat: {
    supportsDeveloperRole: false,
  },
};

export const xiaomi = createProvider({
  id: "xiaomi",
  name: "Xiaomi",
  baseUrl: "https://api.xiaomimimo.com/v1",
  auth: {
    apiKey: envApiKeyAuth("Xiaomi API key", ["XIAOMI_API_KEY"]),
  },
  models: [mimo],
  api: openAICompletionsApi(),
});

export default [xiaomi, ...builtinProviders()];
