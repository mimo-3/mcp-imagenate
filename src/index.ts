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

// ─── Schemas ─────────────────────────────────────────────────────────────────

const GenerateImageSchema = {
  prompt: z.string().describe("Text prompt describing the image to generate"),

  model: z
    .enum(["nano-banana-2", "nano-banana-pro"])
    .default("nano-banana-2")
    .describe("Model to use. nano-banana-2 is faster; nano-banana-pro is higher quality"),

  resolution: z
    .enum(["1K", "2K", "4K"])
    .default("1K")
    .describe("Output image resolution. Higher values may not be supported by all models"),

  aspectRatio: z
    .enum(["1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "21:9"])
    .default("1:1")
    .describe("Aspect ratio of the generated image"),

  thinkingLevel: z
    .enum(["none", "low", "medium", "high"])
    .default("medium")
    .describe(
      "Depth of model reasoning before generation. none disables thinking; high produces the most refined output at higher cost"
    ),

  mode: z
    .enum(["image", "image_and_text"])
    .default("image")
    .describe("Response mode. image returns only the image; image_and_text also returns a description"),

  numberOfImages: z
    .number()
    .int()
    .min(1)
    .max(4)
    .default(1)
    .describe("Number of images to generate (1–4)"),

  outputDir: z
    .string()
    .describe("Directory path where generated images will be saved"),
};

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
  async ({ prompt, model, resolution, aspectRatio, thinkingLevel, mode, numberOfImages, outputDir }) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY environment variable is not set");
    }

    const ai = new GoogleGenAI({ apiKey });

    const responseModalities = mode === "image" ? ["IMAGE"] : ["TEXT", "IMAGE"];

    const config: Record<string, unknown> = {
      responseModalities,
      imageConfig: {
        imageSize: resolution,
        aspectRatio,
        numberOfImages,
      },
    };

    if (thinkingLevel !== "none") {
      config.thinkingConfig = {
        thinkingLevel: thinkingLevel.toUpperCase(),
      };
    }

    const response = await ai.models.generateContent({
      model: MODELS[model],
      contents: prompt,
      config,
    });

    const parts = response.candidates?.[0]?.content?.parts ?? [];

    fs.mkdirSync(outputDir, { recursive: true });

    const savedFiles: string[] = [];
    let textContent = "";

    for (const part of parts) {
      if (part.inlineData?.data) {
        const mimeType = part.inlineData.mimeType ?? "image/png";
        const ext = mimeType.split("/")[1] ?? "png";
        const filename = `${Date.now()}-${savedFiles.length + 1}.${ext}`;
        const filePath = path.resolve(outputDir, filename);
        fs.writeFileSync(filePath, Buffer.from(part.inlineData.data, "base64"));
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
      settings: { resolution, aspectRatio, thinkingLevel, mode, numberOfImages },
    };
    if (textContent) {
      result.description = textContent.trim();
    }

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  }
);

// ─── Start ───────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
