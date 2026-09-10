#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as path from "path";
import {
  ASPECT_RATIOS,
  BACKGROUNDS,
  generateImageToDisk,
  RESOLUTIONS,
} from "./generate.js";
import {
  generateVideoToDisk,
  VIDEO_ASPECT_RATIOS,
  VIDEO_RESOLUTIONS,
} from "./generate-video.js";
import { createRegistry, keysFromEnv } from "./providers/registry.js";
import { createVideoRegistry } from "./providers/video-registry.js";
import { getDefaultOutputBaseDir } from "./sandbox.js";

// ─── Environment ─────────────────────────────────────────────────────────────

const outputBaseDir = process.env.NANO_BANANA_OUTPUT_DIR
  ? path.resolve(process.env.NANO_BANANA_OUTPUT_DIR)
  : getDefaultOutputBaseDir();

if (!process.env.NANO_BANANA_OUTPUT_DIR) {
  console.error(
    `Warning: NANO_BANANA_OUTPUT_DIR is not set. Defaulting to ${outputBaseDir}`,
  );
}

// ─── Registry (probes API keys, exits if none set) ───────────────────────────

const keys = keysFromEnv();
const registry = createRegistry(keys);
const videoRegistry = createVideoRegistry(keys);

if (registry.models.length === 0) {
  console.error(
    "Error: No API keys configured. Set at least one of: GEMINI_API_KEY / NANO_BANANA_API_KEY, OPENAI_API_KEY / GPT_IMAGE_API_KEY, BFL_API_KEY, REVE_API_KEY / REVE_API_TOKEN",
  );
  process.exit(1);
}

const availableModels = registry.models;
// Non-null: guarded by the models.length check above.
const defaultModel = registry.defaultModel!;

// Named in the `background` description so the list stays honest as providers
// gain or lose the capability, instead of hardcoding today's answer in prose.
const transparentModels = availableModels.filter(
  (name) => registry.resolve(name).supportsTransparentBackground,
);

// ─── Schemas ─────────────────────────────────────────────────────────────────

const GenerateImageSchema = {
  prompt: z
    .string()
    .min(1)
    .max(32_000)
    .describe("Text prompt describing the image to generate"),

  model: z
    .enum(availableModels as [string, ...string[]])
    .default(defaultModel)
    .describe(
      "Model to use. Available models depend on configured API keys",
    ),

  resolution: z
    .enum(RESOLUTIONS as [string, ...string[]])
    .default("1K")
    .describe(
      "Output image resolution. Higher values may not be supported by all models",
    ),

  aspectRatio: z
    .enum(ASPECT_RATIOS as [string, ...string[]])
    .default("1:1")
    .describe("Aspect ratio of the generated image"),

  background: z
    .enum(BACKGROUNDS as [string, ...string[]])
    .default("auto")
    .describe(
      "What the image sits on. transparent saves a PNG with an alpha channel and is supported by " +
        (transparentModels.length > 0
          ? `${transparentModels.join(", ")} only`
          : "none of the configured models") +
        " — requesting it on any other model fails with an error rather than returning a silently opaque image. " +
        "opaque always fills the background; auto lets the model decide",
    ),

  mode: z
    .enum(["image", "image_and_text"])
    .default("image")
    .describe(
      "Response mode. image returns only the image; image_and_text also returns a description (Google models only)",
    ),

  outputDir: z
    .string()
    .default(".")
    .describe(
      "Directory path where generated images will be saved. " +
        "If NANO_BANANA_OUTPUT_DIR is set, relative paths are resolved from that base " +
        "and all paths are sandboxed within it.",
    ),

  thinking: z
    .enum(["none", "auto"])
    .default("auto")
    .describe(
      "Controls model thinking before generation (Google models only). none disables thinking; auto lets the model decide",
    ),

  inputImages: z
    .array(z.string())
    .optional()
    .describe(
      "File paths of images to include as input alongside the prompt (supports PNG, JPEG, WEBP, GIF). " +
        "Supported by Google models, OpenAI gpt-image models (uses the images.edit endpoint) " +
        "and Reve (sent as v2 references).",
    ),
};

// ─── Server ──────────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "mcp-imagenate",
  version: "0.6.0",
});

server.registerTool(
  "generate_image",
  {
    title: "Generate Image",
    description:
      "Generate images using multiple providers (Google Gemini, OpenAI, BFL FLUX, Reve). " +
      "Images are saved to disk and the file paths are returned. " +
      "Transparent output (background: \"transparent\") requires an OpenAI gpt-image model; " +
      "the other providers reject it with an error instead of returning an opaque image.",
    inputSchema: GenerateImageSchema,
  },
  async ({
    prompt,
    model,
    resolution,
    aspectRatio,
    mode,
    background,
    outputDir,
    thinking,
    inputImages,
  }) => {
    const outcome = await generateImageToDisk({
      registry,
      prompt,
      model,
      resolution: resolution as "1K" | "2K" | "4K",
      aspectRatio: aspectRatio as "1:1",
      mode,
      thinking,
      background: background as "auto",
      outputDir,
      outputBaseDir,
      inputImages,
    });

    const response: Record<string, unknown> = {
      model: outcome.model,
      savedFiles: outcome.savedFiles,
      settings: outcome.settings,
    };
    if (outcome.description) {
      response.description = outcome.description;
    }

    return {
      content: [
        { type: "text" as const, text: JSON.stringify(response, null, 2) },
      ],
    };
  },
);

// ─── Video ───────────────────────────────────────────────────────────────────

// Registered only when a video-capable key is present, so hosts without one
// never see a tool that can only fail.
if (videoRegistry.models.length > 0) {
  const videoModels = videoRegistry.models;
  const defaultVideoModel = videoRegistry.defaultModel!;
  const { minDurationSeconds, maxDurationSeconds } =
    videoRegistry.resolve(defaultVideoModel);

  const GenerateVideoSchema = {
    prompt: z
      .string()
      .min(1)
      .max(32_000)
      .describe(
        "Text prompt describing the clip: subject, motion, camera, and any on-screen text spelled out exactly",
      ),

    model: z
      .enum(videoModels as [string, ...string[]])
      .default(defaultVideoModel)
      .describe("Video model to use. Available models depend on configured API keys"),

    durationSeconds: z
      .number()
      .int()
      .min(minDurationSeconds)
      .max(maxDurationSeconds)
      .default(5)
      .describe(
        `Clip length in whole seconds (${minDurationSeconds}–${maxDurationSeconds}). ` +
          "Longer clips cost proportionally more and take longer to generate",
      ),

    resolution: z
      .enum(VIDEO_RESOLUTIONS as [string, ...string[]])
      .default("720p")
      .describe(
        "Playback resolution. 360p is the cheapest and fastest; 1080p and 4k are upscaled from 720p",
      ),

    aspectRatio: z
      .enum(VIDEO_ASPECT_RATIOS as [string, ...string[]])
      .default("16:9")
      .describe("16:9 landscape or 9:16 portrait"),

    outputDir: z
      .string()
      .default(".")
      .describe(
        "Directory path where the generated video will be saved. " +
          "If NANO_BANANA_OUTPUT_DIR is set, relative paths are resolved from that base " +
          "and all paths are sandboxed within it.",
      ),

    inputImages: z
      .array(z.string())
      .optional()
      .describe(
        "File paths of reference images (PNG, JPEG, WEBP, GIF) sent ahead of the prompt: " +
          "a first frame to animate, or subjects and styles to keep consistent. " +
          "Refer to them in the prompt as <IMAGE_REF_1>, <IMAGE_REF_2>, … in order.",
      ),

    previousInteractionId: z
      .string()
      .optional()
      .describe(
        "interactionId from an earlier generate_video result. Set it to extend that clip " +
          "instead of starting a new one; the prompt then describes what happens next.",
      ),
  };

  server.registerTool(
    "generate_video",
    {
      title: "Generate Video",
      description:
        "Generate a short video clip with audio using Google Gemini Omni. " +
        "The mp4 is saved to disk and its path is returned along with an interactionId " +
        "that can be passed back as previousInteractionId to extend the clip. " +
        "Text written in the prompt is rendered legibly on screen.",
      inputSchema: GenerateVideoSchema,
    },
    async ({
      prompt,
      model,
      durationSeconds,
      resolution,
      aspectRatio,
      outputDir,
      inputImages,
      previousInteractionId,
    }) => {
      const outcome = await generateVideoToDisk({
        registry: videoRegistry,
        prompt,
        model,
        durationSeconds,
        resolution: resolution as "720p",
        aspectRatio: aspectRatio as "16:9",
        outputDir,
        outputBaseDir,
        inputImages,
        previousInteractionId,
      });

      const response: Record<string, unknown> = {
        model: outcome.model,
        savedFile: outcome.savedFile,
        settings: outcome.settings,
      };
      if (outcome.description) response.description = outcome.description;
      if (outcome.interactionId) response.interactionId = outcome.interactionId;

      return {
        content: [
          { type: "text" as const, text: JSON.stringify(response, null, 2) },
        ],
      };
    },
  );
}

// ─── Start ───────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
