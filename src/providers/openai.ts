import OpenAI from "openai";
import type { GenerateParams, GenerateResult, ProviderRegistration } from "./types.js";

function resolveSize(resolution: string, aspectRatio: string): string {
  const map: Record<string, Record<string, string>> = {
    "1K": {
      "1:1": "1024x1024",
      "2:3": "1024x1536",
      "3:2": "1536x1024",
      "3:4": "1024x1536",
      "4:3": "1536x1024",
      "9:16": "1024x1536",
      "16:9": "1536x1024",
      "21:9": "1536x1024",
    },
    "2K": {
      "1:1": "1024x1024",
      "2:3": "1024x1536",
      "3:2": "1536x1024",
      "3:4": "1024x1536",
      "4:3": "1536x1024",
      "9:16": "1024x1536",
      "16:9": "1536x1024",
      "21:9": "1536x1024",
    },
    "4K": {
      "1:1": "1024x1024",
      "2:3": "1024x1536",
      "3:2": "1536x1024",
      "3:4": "1024x1536",
      "4:3": "1536x1024",
      "9:16": "1024x1536",
      "16:9": "1536x1024",
      "21:9": "1536x1024",
    },
  };
  return map[resolution]?.[aspectRatio] ?? "1024x1024";
}

function resolveQuality(resolution: string): "low" | "medium" | "high" {
  if (resolution === "4K") return "high";
  if (resolution === "2K") return "medium";
  return "low";
}

export function createOpenAIProvider(apiKey: string): ProviderRegistration {
  const client = new OpenAI({ apiKey });

  const generate = async (params: GenerateParams): Promise<GenerateResult> => {
    if (params.inputImages?.length) {
      throw new Error(
        "gpt-image-1.5 does not support input images. Use the prompt to describe the desired image.",
      );
    }

    const size = resolveSize(params.resolution, params.aspectRatio);
    const quality = resolveQuality(params.resolution);

    const result = await client.images.generate({
      model: "gpt-image-1.5",
      prompt: params.prompt,
      n: 1,
      size: size as "1024x1024",
      quality,
      response_format: "b64_json",
    });

    const images = (result.data ?? [])
      .filter((d) => d.b64_json)
      .map((d) => Buffer.from(d.b64_json!, "base64"));

    if (images.length === 0) {
      throw new Error("No images were returned by gpt-image-1.5");
    }

    return { images, mimeType: "image/png" };
  };

  return {
    models: { "gpt-image-1.5": "gpt-image-1.5" },
    generate,
  };
}
