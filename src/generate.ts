/**
 * The end-to-end "prompt in, files on disk out" flow, shared by the standalone
 * MCP server (src/index.ts) and by embedders that use this package as a library.
 *
 * Keeping this here rather than in the tool handler means input validation,
 * the MIME allowlist, the 20 MB input cap and the output naming scheme all stay
 * in one place instead of being reimplemented per host.
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import type { ImageRegistry } from "./providers/registry.js";
import { MAX_INPUT_IMAGE_SIZE, resolveInputImagePath, resolveOutputDir } from "./sandbox.js";

/** Output MIME -> file extension. Anything unlisted is saved as .png. */
const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

/** Accepted input image extensions -> the MIME we declare to the provider. */
const EXT_TO_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

export type Resolution = "1K" | "2K" | "4K";
export type AspectRatio = "1:1" | "2:3" | "3:2" | "3:4" | "4:3" | "9:16" | "16:9" | "21:9";
export type GenerationMode = "image" | "image_and_text";
export type Thinking = "none" | "auto";

export const RESOLUTIONS: Resolution[] = ["1K", "2K", "4K"];
export const ASPECT_RATIOS: AspectRatio[] = [
  "1:1",
  "2:3",
  "3:2",
  "3:4",
  "4:3",
  "9:16",
  "16:9",
  "21:9",
];

export interface GenerateImageOptions {
  /** Registry to resolve `model` against. */
  registry: ImageRegistry;
  prompt: string;
  /** Friendly model name (e.g. "gpt-image-2"). */
  model: string;
  resolution?: Resolution;
  aspectRatio?: AspectRatio;
  /** Google models only; ignored elsewhere. */
  mode?: GenerationMode;
  /** Google models only; ignored elsewhere. */
  thinking?: Thinking;
  /**
   * Where to write the generated files. Relative paths resolve against
   * `outputBaseDir` when one is set, otherwise against process.cwd().
   */
  outputDir?: string;
  /**
   * Sandbox root. When set, output and input paths must stay inside it
   * (symlinks are resolved and re-checked). Pass `null` — the default — for no
   * path restriction, which is the right choice when the caller already
   * controls which paths reach this function.
   */
  outputBaseDir?: string | null;
  /** Paths of images to send alongside the prompt. */
  inputImages?: string[];
}

export interface GenerateImageOutcome {
  /** The provider-level model id that actually ran. */
  model: string;
  /** Absolute paths of the files written. */
  savedFiles: string[];
  /** Text returned alongside the image (Google models in image_and_text mode). */
  description?: string;
  settings: {
    resolution: Resolution;
    aspectRatio: AspectRatio;
    mode: GenerationMode;
  };
}

/** Read, validate and buffer the input images for a request. */
async function readInputImages(
  inputImages: string[],
  outputBaseDir: string | null,
): Promise<{ buffers: Buffer[]; mimeTypes: string[] }> {
  const buffers: Buffer[] = [];
  const mimeTypes: string[] = [];

  for (const imagePath of inputImages) {
    const resolvedPath = resolveInputImagePath(imagePath, outputBaseDir);
    const ext = path.extname(resolvedPath).toLowerCase().slice(1);
    const mimeType = EXT_TO_MIME[ext];
    if (!mimeType) {
      throw new Error(
        `Unsupported input image format: .${ext}. Supported: png, jpg, jpeg, webp, gif`,
      );
    }

    const stat = await fs.promises.stat(resolvedPath);
    if (!stat.isFile()) {
      throw new Error(`Input image path is not a file: ${imagePath}`);
    }
    if (stat.size > MAX_INPUT_IMAGE_SIZE) {
      throw new Error(
        `Input image exceeds 20 MB limit: ${imagePath} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`,
      );
    }

    let imageData: Buffer;
    try {
      imageData = await fs.promises.readFile(resolvedPath);
    } catch {
      throw new Error(`Could not read input image: ${imagePath}`);
    }
    buffers.push(imageData);
    mimeTypes.push(mimeType);
  }

  return { buffers, mimeTypes };
}

/** Generate images and write them to disk, returning the paths written. */
export async function generateImageToDisk(
  options: GenerateImageOptions,
): Promise<GenerateImageOutcome> {
  const {
    registry,
    prompt,
    model,
    resolution = "1K",
    aspectRatio = "1:1",
    mode = "image",
    thinking = "auto",
    outputDir = ".",
    outputBaseDir = null,
    inputImages,
  } = options;

  const resolvedDir = resolveOutputDir(outputDir, outputBaseDir);

  const { buffers, mimeTypes } =
    inputImages && inputImages.length > 0
      ? await readInputImages(inputImages, outputBaseDir)
      : { buffers: [], mimeTypes: [] };

  // Resolve model -> provider before doing any filesystem writes.
  const { modelId, generate } = registry.resolve(model);

  const result = await generate({
    prompt,
    modelId,
    resolution,
    aspectRatio,
    mode,
    thinking,
    inputImages: buffers.length > 0 ? buffers : undefined,
    inputImageMimeTypes: mimeTypes.length > 0 ? mimeTypes : undefined,
  });

  await fs.promises.mkdir(resolvedDir, { recursive: true });

  const savedFiles: string[] = [];
  const ext = MIME_TO_EXT[result.mimeType] ?? "png";

  for (const imageBuffer of result.images) {
    const uid = crypto.randomUUID().slice(0, 8);
    const filename = `${Date.now()}-${uid}.${ext}`;
    const filePath = path.join(resolvedDir, filename);
    await fs.promises.writeFile(filePath, imageBuffer);
    savedFiles.push(filePath);
  }

  const outcome: GenerateImageOutcome = {
    model: modelId,
    savedFiles,
    settings: { resolution, aspectRatio, mode },
  };
  if (result.description) {
    outcome.description = result.description;
  }
  return outcome;
}
