import { createGoogleProvider } from "./google.js";
import { createOpenAIProvider } from "./openai.js";
import { createFluxProvider } from "./flux.js";
import type { ProviderFn } from "./types.js";

interface ResolvedModel {
  modelId: string;
  generate: ProviderFn;
}

const registry = new Map<string, ResolvedModel>();

export function initRegistry(): string[] {
  // Google
  const googleKey =
    process.env.NANO_BANANA_API_KEY ?? process.env.GEMINI_API_KEY;
  if (googleKey) {
    const p = createGoogleProvider(googleKey);
    for (const [friendly, modelId] of Object.entries(p.models)) {
      registry.set(friendly, { modelId, generate: p.generate });
    }
  }

  // OpenAI
  const openaiKey =
    process.env.OPENAI_API_KEY ?? process.env.GPT_IMAGE_API_KEY;
  if (openaiKey) {
    const p = createOpenAIProvider(openaiKey);
    for (const [friendly, modelId] of Object.entries(p.models)) {
      registry.set(friendly, { modelId, generate: p.generate });
    }
  }

  // BFL FLUX
  const bflKey = process.env.BFL_API_KEY;
  if (bflKey) {
    const p = createFluxProvider(bflKey);
    for (const [friendly, modelId] of Object.entries(p.models)) {
      registry.set(friendly, { modelId, generate: p.generate });
    }
  }

  const available = Array.from(registry.keys());
  if (available.length === 0) {
    console.error(
      "Error: No API keys configured. Set at least one of: GEMINI_API_KEY / NANO_BANANA_API_KEY, OPENAI_API_KEY / GPT_IMAGE_API_KEY, BFL_API_KEY",
    );
    process.exit(1);
  }

  return available;
}

export function resolveModel(friendlyName: string): ResolvedModel {
  const entry = registry.get(friendlyName);
  if (!entry) {
    throw new Error(
      `Unknown model: ${friendlyName}. Available: ${Array.from(registry.keys()).join(", ")}`,
    );
  }
  return entry;
}

export function getDefaultModel(): string {
  if (registry.has("nano-banana-2")) return "nano-banana-2";
  return registry.keys().next().value!;
}
