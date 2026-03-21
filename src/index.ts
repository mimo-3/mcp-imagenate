#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";

// ─── Model IDs ───────────────────────────────────────────────────────────────

const MODELS = {
  "nano-banana-2": "gemini-3.1-flash-image-preview",
  "nano-banana-pro": "gemini-3-pro-image-preview",
} as const;

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

// ─── Environment (validated at startup) ──────────────────────────────────────

const apiKey = process.env.NANO_BANANA_API_KEY ?? process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error(
    "Error: NANO_BANANA_API_KEY or GEMINI_API_KEY environment variable is not set",
  );
  process.exit(1);
}

// When set, all outputDir values are resolved relative to this base and
// sandboxed within it. Recommended for production deployments.
const outputBaseDir = process.env.NANO_BANANA_OUTPUT_DIR
  ? path.resolve(process.env.NANO_BANANA_OUTPUT_DIR)
  : null;

const ai = new GoogleGenAI({ apiKey });

// ─── Schemas ─────────────────────────────────────────────────────────────────

const GenerateImageSchema = {
  prompt: z
    .string()
    .min(1)
    .max(10_000)
    .describe("Text prompt describing the image to generate"),

  model: z
    .enum(["nano-banana-2", "nano-banana-pro"])
    .default("nano-banana-2")
    .describe(
      "Model to use. nano-banana-2 is faster; nano-banana-pro is higher quality",
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
      "Response mode. image returns only the image; image_and_text also returns a description",
    ),

  numberOfImages: z
    .number()
    .int()
    .min(1)
    .max(4)
    .default(1)
    .describe("Number of images to generate (1–4)"),

  outputDir: z
    .string()
    .default(".")
    .describe(
      "Directory path where generated images will be saved. " +
        "If NANO_BANANA_OUTPUT_DIR is set, relative paths are resolved from that base " +
        "and all paths are sandboxed within it.",
    ),

  thinkingLevel: z
    .enum(["minimal", "high"])
    .default("minimal")
    .describe(
      "Depth of model reasoning before generation. minimal is faster; high produces more refined output at higher cost"
    ),

  inputImages: z
    .array(z.string())
    .optional()
    .describe(
      "File paths of images to include as input alongside the prompt (supports PNG, JPEG, WEBP, GIF). " +
        "Useful for image editing, style reference, or multi-image instructions."
    ),
};

// ─── Path sandbox helper ──────────────────────────────────────────────────────

function resolveOutputDir(outputDir: string): string {
  if (outputBaseDir !== null) {
    const resolved = path.resolve(outputBaseDir, outputDir);
    const isInside =
      resolved === outputBaseDir ||
      resolved.startsWith(outputBaseDir + path.sep);
    if (!isInside) {
      throw new Error(
        `outputDir is outside the allowed base directory (NANO_BANANA_OUTPUT_DIR=${outputBaseDir})`,
      );
    }
    return resolved;
  }
  return path.resolve(outputDir);
}

// ─── Server ──────────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "nano-banana-mcp",
  version: "0.1.0",
});

server.registerTool(
  "generate_image",
  {
    title: "Generate Image",
    description:
      "Generate images using Nano Banana models (Google Gemini image generation via AI Studio). " +
      "Images are saved to disk and the file paths are returned.",
    inputSchema: GenerateImageSchema,
  },
  async ({
    prompt,
    model,
    resolution,
    aspectRatio,
    mode,
    numberOfImages,
    outputDir,
    thinkingLevel,
    inputImages,
  }) => {
    const resolvedDir = resolveOutputDir(outputDir);

    // Build contents: [image parts..., text prompt]
    type Part =
      | { text: string }
      | { inlineData: { mimeType: string; data: string } };
    const contentParts: Part[] = [];

    if (inputImages && inputImages.length > 0) {
      for (const imagePath of inputImages) {
        const resolvedPath = path.resolve(imagePath);
        const ext = path.extname(resolvedPath).toLowerCase().slice(1);
        const mimeType = EXT_TO_MIME[ext];
        if (!mimeType) {
          throw new Error(
            `Unsupported input image format: .${ext}. Supported: png, jpg, jpeg, webp, gif`,
          );
        }
        let imageData: Buffer;
        try {
          imageData = await fs.promises.readFile(resolvedPath);
        } catch {
          throw new Error(`Could not read input image: ${resolvedPath}`);
        }
        contentParts.push({
          inlineData: { mimeType, data: imageData.toString("base64") },
        });
      }
    }
    contentParts.push({ text: prompt });

    const responseModalities = mode === "image" ? ["IMAGE"] : ["TEXT", "IMAGE"];

    const config: Record<string, unknown> = {
      responseModalities,
      imageConfig: {
        imageSize: resolution,
        aspectRatio,
        numberOfImages,
      },
      thinkingConfig: {
        thinkingLevel,
      },
    };

    let response;
    try {
      response = await ai.models.generateContent({
        model: MODELS[model],
        contents: contentParts.length === 1 ? prompt : contentParts,
        config,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      throw new Error(`Image generation failed: ${message}`);
    }

    const parts = response.candidates?.[0]?.content?.parts ?? [];

    await fs.promises.mkdir(resolvedDir, { recursive: true });

    const savedFiles: string[] = [];
    let textContent = "";

    for (const part of parts) {
      if (part.inlineData?.data) {
        const mimeType = part.inlineData.mimeType ?? "image/png";
        const ext = MIME_TO_EXT[mimeType] ?? "png";
        const filename = `${Date.now()}-${savedFiles.length + 1}.${ext}`;
        const filePath = path.join(resolvedDir, filename);
        await fs.promises.writeFile(
          filePath,
          Buffer.from(part.inlineData.data, "base64"),
        );
        savedFiles.push(filePath);
      } else if (typeof part.text === "string" && part.text.trim()) {
        textContent += part.text;
      }
    }

    if (savedFiles.length === 0) {
      throw new Error("No images were returned by the model");
    }

    const result: Record<string, unknown> = {
      model: MODELS[model],
      savedFiles,
      settings: { resolution, aspectRatio, mode, numberOfImages },
    };
    if (textContent) {
      result.description = textContent.trim();
    }

    return {
      content: [
        { type: "text" as const, text: JSON.stringify(result, null, 2) },
      ],
    };
  },
);

// ─── Start ───────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
