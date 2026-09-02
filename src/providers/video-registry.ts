import { createOmniVideoProvider } from "./omni-video.js";
import type { ProviderKeys } from "./registry.js";
import type { VideoProviderFn, VideoProviderRegistration } from "./video-types.js";

export interface ResolvedVideoModel {
  modelId: string;
  generate: VideoProviderFn;
  minDurationSeconds: number;
  maxDurationSeconds: number;
  maxInputImages?: number;
}

/** An immutable view over the video models available for a given set of keys. */
export interface VideoRegistry {
  readonly models: string[];
  readonly defaultModel: string | undefined;
  resolve(friendlyName: string): ResolvedVideoModel;
}

/**
 * Build a video registry from the same keys the image registry takes. Only
 * Google contributes today; the split from `createRegistry` is so a host can
 * expose `generate_video` without every image provider learning about clips.
 */
export function createVideoRegistry(keys: ProviderKeys): VideoRegistry {
  const entries = new Map<string, ResolvedVideoModel>();

  const register = (registration: VideoProviderRegistration): void => {
    for (const [friendly, modelId] of Object.entries(registration.models)) {
      const entry: ResolvedVideoModel = {
        modelId,
        generate: registration.generate,
        minDurationSeconds: registration.minDurationSeconds,
        maxDurationSeconds: registration.maxDurationSeconds,
      };
      if (registration.maxInputImages !== undefined) {
        entry.maxInputImages = registration.maxInputImages;
      }
      entries.set(friendly, entry);
    }
  };

  if (keys.google) register(createOmniVideoProvider(keys.google));

  const models = Array.from(entries.keys());

  return {
    models,
    defaultModel: models[0],
    resolve(friendlyName: string): ResolvedVideoModel {
      const entry = entries.get(friendlyName);
      if (!entry) {
        throw new Error(
          models.length === 0
            ? `No video models are available: no provider API key is configured.`
            : `Unknown video model: ${friendlyName}. Available: ${models.join(", ")}`,
        );
      }
      return entry;
    },
  };
}
