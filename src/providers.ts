/**
 * Provider registry: where to forward, how to inject the real key, and which scope
 * matcher applies. Adding a provider is a data change, not a code change.
 */
export interface Provider {
  name: string;
  baseUrl: string;
  kind: "rest" | "llm";
  /** Header the real key goes into, and how to format it. */
  authHeader: string;
  authScheme?: string; // e.g. "Bearer "; omit for raw value
}

export const PROVIDERS: Record<string, Provider> = {
  openai: {
    name: "openai",
    baseUrl: "https://api.openai.com",
    kind: "llm",
    authHeader: "authorization",
    authScheme: "Bearer ",
  },
  anthropic: {
    name: "anthropic",
    baseUrl: "https://api.anthropic.com",
    kind: "llm",
    authHeader: "x-api-key",
  },
  qwen: {
    // Alibaba Model Studio, OpenAI-compatible mode. The grantee calls
    // /v1/chat/completions; we forward to <base>/v1/chat/completions.
    name: "qwen",
    baseUrl:
      "https://ws-czwjlzd00zfipyzp.ap-southeast-1.maas.aliyuncs.com/compatible-mode",
    kind: "llm",
    authHeader: "authorization",
    authScheme: "Bearer ",
  },
  stripe: {
    name: "stripe",
    baseUrl: "https://api.stripe.com",
    kind: "rest",
    authHeader: "authorization",
    authScheme: "Bearer ",
  },
};

export function getProvider(name: string): Provider | undefined {
  return PROVIDERS[name];
}
