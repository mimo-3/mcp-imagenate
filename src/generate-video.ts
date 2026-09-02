/**
 * The "prompt in, mp4 on disk out" flow for video, mirroring generate.ts.
 * Kept separate so the image flow's settings shape stays exact: a clip has a
 * duration and a playback resolution, not a 1K/2K/4K size or a background.
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { readInputImages } from "./generate.js";
import type { VideoRegistry } from "./providers/video-registry.js";
import type { VideoAspectRatio, VideoResolution } from "./providers/video-types.js";
import { resolveOutputDir } from "./sandbox.js";

/** Output MIME -> file extension. Anything unlisted is saved as .mp4. */
const MIME_TO_EXT: Record<string, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
};

export const VIDEO_RESOLUTIONS: VideoResolution[] = ["360p", "720p", "1080p", "4k"];
export const VIDEO_ASPECT_RATIOS: VideoAspectRatio[] = ["16:9", "9:16"];

export interface GenerateVideoOptions {
  registry: VideoRegistry;
  prompt: string;
  /** Friendly model name (e.g. "omni-flash"). */
  model: string;
  /** Whole seconds; must fall within the model's supported range. */
  durationSeconds?: number;
  resolution?: VideoResolution;
  aspectRatio?: VideoAspectRatio;
  /** See `GenerateImageOptions.outputDir`. */
  outputDir?: string;
  /** See `GenerateImageOptions.outputBaseDir`. */
  outputBaseDir?: string | null;
  /** Reference images sent ahead of the prompt. */
  inputImages?: string[];
  /** Continue an earlier clip instead of starting a new one. */
  previousInteractionId?: string;
}

export interface GenerateVideoOutcome {
  /** The provider-level model id that actually ran. */
  model: string;
  /** Absolute path of the file written. */
  savedFile: string;
  /** Text the model returned alongside the clip, when any. */
  description?: string;
  /** Pass back as `previousInteractionId` to extend this clip. */
  interactionId?: string;
  settings: {
    durationSeconds: number;
    resolution: VideoResolution;
    aspectRatio: VideoAspectRatio;
  };
}

export async function generateVideoToDisk(
  options: GenerateVideoOptions,
): Promise<GenerateVideoOutcome> {
  const {
    registry,
    prompt,
    model,
    durationSeconds = 5,
    resolution = "720p",
    aspectRatio = "16:9",
    outputDir = ".",
    outputBaseDir = null,
    inputImages,
    previousInteractionId,
  } = options;

  const resolvedDir = resolveOutputDir(outputDir, outputBaseDir);

  const { modelId, generate, minDurationSeconds, maxDurationSeconds, maxInputImages } =
    registry.resolve(model);

  // Check the range here rather than letting the API answer: a clip is paid
  // for by the second, and a rejected request is cheaper than a truncated one.
  if (
    !Number.isInteger(durationSeconds) ||
    durationSeconds < minDurationSeconds ||
    durationSeconds > maxDurationSeconds
  ) {
    throw new Error(
      `${model} generates clips of ${minDurationSeconds}–${maxDurationSeconds} whole seconds (got ${durationSeconds}).`,
    );
  }

  if (
    maxInputImages !== undefined &&
    inputImages !== undefined &&
    inputImages.length > maxInputImages
  ) {
    throw new Error(
      `${model} accepts at most ${maxInputImages} input images (got ${inputImages.length}).`,
    );
  }

  const { buffers, mimeTypes } =
    inputImages && inputImages.length > 0
      ? await readInputImages(inputImages, outputBaseDir)
      : { buffers: [], mimeTypes: [] };

  const result = await generate({
    prompt,
    modelId,
    durationSeconds,
    resolution,
    aspectRatio,
    inputImages: buffers.length > 0 ? buffers : undefined,
    inputImageMimeTypes: mimeTypes.length > 0 ? mimeTypes : undefined,
    previousInteractionId,
  });

  await fs.promises.mkdir(resolvedDir, { recursive: true });

  const ext = MIME_TO_EXT[result.mimeType] ?? "mp4";
  const uid = crypto.randomUUID().slice(0, 8);
  const savedFile = path.join(resolvedDir, `${Date.now()}-${uid}.${ext}`);
  await fs.promises.writeFile(savedFile, result.video);

  const outcome: GenerateVideoOutcome = {
    model: modelId,
    savedFile,
    settings: { durationSeconds, resolution, aspectRatio },
  };
  if (result.description) outcome.description = result.description;
  if (result.interactionId) outcome.interactionId = result.interactionId;
  return outcome;
}
