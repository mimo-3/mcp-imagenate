#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { initRegistry, resolveModel, getDefaultModel } from "./providers/registry.js";
import { resolveOutputDir, resolveInputImagePath, getDefaultOutputBaseDir, MAX_INPUT_IMAGE_SIZE } from "./sandbox.js";

// ─── MIME / extension allowlists ─────────────────────────────────────────────

const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

const EXT_TO_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

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

const availableModels = initRegistry();
const defaultModel = getDefaultModel();

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
    .enum(["1K", "2K", "4K"])
    .default("1K")
    .describe(
      "Output image resolution. Higher values may not be supported by all models",
    ),

  aspectRatio: z
    .enum(["1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "21:9"])
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
        "Currently supported by Google models only.",
    ),
};

// ─── Server ──────────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "mcp-imagenate",
  version: "0.1.8",
});

server.registerTool(
  "generate_image",
  {
    title: "Generate Image",
    description:
      "Generate images using multiple providers (Google Gemini, OpenAI, BFL FLUX). " +
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
    const resolvedDir = resolveOutputDir(outputDir, outputBaseDir);

    // Read input images into Buffers
    const imageBuffers: Buffer[] = [];
    const imageMimeTypes: string[] = [];

    if (inputImages && inputImages.length > 0) {
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
        imageBuffers.push(imageData);
        imageMimeTypes.push(mimeType);
      }
    }

    // Resolve model → provider
    const { modelId, generate } = resolveModel(model);

    // Call provider
    const result = await generate({
      prompt,
      modelId,
      resolution,
      aspectRatio,
      mode,
      thinking,
      inputImages: imageBuffers.length > 0 ? imageBuffers : undefined,
      inputImageMimeTypes:
        imageMimeTypes.length > 0 ? imageMimeTypes : undefined,
    });

    // Save images to disk
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

    // Build response
    const response: Record<string, unknown> = {
      model: modelId,
      savedFiles,
      settings: { resolution, aspectRatio, mode },
    };
    if (result.description) {
      response.description = result.description;
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
