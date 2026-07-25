import { createGoogleProvider } from "./google.js";
import { createOpenAIProvider } from "./openai.js";
import { createFluxProvider } from "./flux.js";
import type { ProviderFn } from "./types.js";

export interface ResolvedModel {
  modelId: string;
  generate: ProviderFn;
}

/**
 * API keys per provider. Every field is optional: a provider whose key is
 * missing simply contributes no models.
 *
 * Keys are passed in explicitly rather than read from the environment so that
 * embedders (see lib.ts) can source them from their own config without having
 * to mutate `process.env`. Use `keysFromEnv()` for the standalone server's
 * historical env-var behaviour.
 */
export interface ProviderKeys {
  google?: string;
  openai?: string;
  flux?: string;
}

/** An immutable view over the models available for a given set of keys. */
export interface ImageRegistry {
  /** Friendly model names available, in registration order. */
  readonly models: string[];
  /** Preferred default model, or undefined when no keys were supplied. */
  readonly defaultModel: string | undefined;
  /** Look up a friendly name. Throws when the model is unknown/unavailable. */
  resolve(friendlyName: string): ResolvedModel;
}

/**
 * Which model to default to when several providers are configured. The first
 * entry that is actually available wins; otherwise the first registered model
 * does.
 *
 * Deliberately just the one entry: picking a "better" fallback per provider
 * would silently change cost and latency for anyone who omits `model`. A
 * Google-only setup must keep defaulting to nano-banana-2, not to the slower
 * and pricier nano-banana-pro.
 */
const DEFAULT_MODEL_PREFERENCE = ["gpt-image-2"];

/**
 * Read provider keys from an environment-like object (standalone server
 * behaviour). The provider-specific variable wins over the generic one for
 * every provider, as documented in the README — previously OpenAI alone had
 * this the other way round.
 */
export function keysFromEnv(env: NodeJS.ProcessEnv = process.env): ProviderKeys {
  const keys: ProviderKeys = {};
  const google = env.NANO_BANANA_API_KEY ?? env.GEMINI_API_KEY;
  const openai = env.GPT_IMAGE_API_KEY ?? env.OPENAI_API_KEY;
  const flux = env.BFL_API_KEY;
  if (google) keys.google = google;
  if (openai) keys.openai = openai;
  if (flux) keys.flux = flux;
  return keys;
}

/**
 * Build a registry from the supplied keys.
 *
 * Never exits the process and never throws on missing keys — an empty registry
 * (`models.length === 0`) is a valid result that callers decide how to surface.
 */
export function createRegistry(keys: ProviderKeys): ImageRegistry {
  const entries = new Map<string, ResolvedModel>();

  const register = (registration: { models: Record<string, string>; generate: ProviderFn }): void => {
    for (const [friendly, modelId] of Object.entries(registration.models)) {
      entries.set(friendly, { modelId, generate: registration.generate });
    }
  };

  if (keys.google) register(createGoogleProvider(keys.google));
  if (keys.openai) register(createOpenAIProvider(keys.openai));
  if (keys.flux) register(createFluxProvider(keys.flux));

  const models = Array.from(entries.keys());
  const defaultModel =
    DEFAULT_MODEL_PREFERENCE.find((name) => entries.has(name)) ?? models[0];

  return {
    models,
    defaultModel,
    resolve(friendlyName: string): ResolvedModel {
      const entry = entries.get(friendlyName);
      if (!entry) {
        throw new Error(
          models.length === 0
            ? `No image models are available: no provider API key is configured.`
            : `Unknown model: ${friendlyName}. Available: ${models.join(", ")}`,
        );
      }
      return entry;
    },
  };
}
