#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as path from "path";
import { ASPECT_RATIOS, generateImageToDisk, RESOLUTIONS } from "./generate.js";
import { createRegistry, keysFromEnv } from "./providers/registry.js";
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

const registry = createRegistry(keysFromEnv());

if (registry.models.length === 0) {
  console.error(
    "Error: No API keys configured. Set at least one of: GEMINI_API_KEY / NANO_BANANA_API_KEY, OPENAI_API_KEY / GPT_IMAGE_API_KEY, BFL_API_KEY, REVE_API_KEY / REVE_API_TOKEN",
  );
  process.exit(1);
}

const availableModels = registry.models;
// Non-null: guarded by the models.length check above.
const defaultModel = registry.defaultModel!;

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
  version: "0.3.1",
});

server.registerTool(
  "generate_image",
  {
    title: "Generate Image",
    description:
      "Generate images using multiple providers (Google Gemini, OpenAI, BFL FLUX, Reve). " +
      "Images are saved to disk and the file paths are returned.",
    inputSchema: GenerateImageSchema,
  },
  async ({
    prompt,
    model,
    resolution,
    aspectRatio,
    mode,
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

// ─── Start ───────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
