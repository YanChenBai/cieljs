import { createProvider, envApiKeyAuth, type Model } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/compat";

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

  contextWindow: 262144,
  maxTokens: 131072,

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
  name: "XiaoMi",

  baseUrl: "https://api.xiaomimimo.com/v1",

  auth: {
    apiKey: envApiKeyAuth("XiaoMi API key", ["XIAOMI_API_KEY"]),
  },

  models: [mimo],

  api: openAICompletionsApi(),
});
