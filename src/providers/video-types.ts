/**
 * Video generation is a separate contract from image generation on purpose.
 * Duration, playback resolution and a single mp4 result do not map onto the
 * 1K/2K/4K, background and `images[]` shape in types.ts, and bending one type
 * to cover both would leave every field half-meaningful for one of them.
 */

export type VideoResolution = "360p" | "720p" | "1080p" | "4k";
export type VideoAspectRatio = "16:9" | "9:16";

export interface VideoGenerateParams {
  prompt: string;
  modelId: string;
  /** Clip length. Providers cap this; see `VideoProviderRegistration`. */
  durationSeconds: number;
  resolution: VideoResolution;
  aspectRatio: VideoAspectRatio;
  /** Reference frames or subjects, in prompt order. */
  inputImages?: Buffer[];
  inputImageMimeTypes?: string[];
  /**
   * Id of an earlier generation to continue from. Providers that support it
   * append to that clip instead of starting a new one.
   */
  previousInteractionId?: string;
}

export interface VideoGenerateResult {
  video: Buffer;
  mimeType: string;
  /** Text the model returned alongside the clip, when any. */
  description?: string;
  /** Handle for extending this clip later, when the provider issues one. */
  interactionId?: string;
}

export type VideoProviderFn = (
  params: VideoGenerateParams,
) => Promise<VideoGenerateResult>;

export interface VideoProviderRegistration {
  models: Record<string, string>;
  generate: VideoProviderFn;
  /** Shortest and longest clip the provider will produce, in seconds. */
  minDurationSeconds: number;
  maxDurationSeconds: number;
  /** See `ProviderRegistration.maxInputImages`. */
  maxInputImages?: number;
}
