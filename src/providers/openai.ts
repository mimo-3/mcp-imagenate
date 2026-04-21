import OpenAI, { toFile } from "openai";
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
      "1:1": "2048x2048",
      "2:3": "1536x2304",
      "3:2": "2304x1536",
      "3:4": "1536x2048",
      "4:3": "2048x1536",
      "9:16": "1152x2048",
      "16:9": "2048x1152",
      "21:9": "2688x1152",
    },
    "4K": {
      "1:1": "2880x2880",
      "2:3": "2304x3456",
      "3:2": "3456x2304",
      "3:4": "2400x3200",
      "4:3": "3200x2400",
      "9:16": "2160x3840",
      "16:9": "3840x2160",
      "21:9": "3840x1648",
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
    const size = resolveSize(params.resolution, params.aspectRatio);
    const quality = resolveQuality(params.resolution);

    const result = params.inputImages?.length
      ? await client.images.edit({
          model: params.modelId,
          image: await Promise.all(
            params.inputImages.map((buf, i) => {
              const mime = params.inputImageMimeTypes?.[i] ?? "image/png";
              const ext = mime.split("/")[1] ?? "png";
              return toFile(buf, `input-${i}.${ext}`, { type: mime });
            }),
          ),
          prompt: params.prompt,
          n: 1,
          size: size as "1024x1024",
          quality,
          output_format: "png",
          background: "auto",
        })
      : await client.images.generate({
          model: params.modelId,
          prompt: params.prompt,
          n: 1,
          size: size as "1024x1024",
          quality,
          output_format: "png",
          moderation: "auto",
          background: "auto",
        });

    const images = (result.data ?? [])
      .filter((d) => d.b64_json)
      .map((d) => Buffer.from(d.b64_json!, "base64"));

    if (images.length === 0) {
      throw new Error(`No images were returned by ${params.modelId}`);
    }

    return { images, mimeType: "image/png" };
  };

  return {
    models: {
      "gpt-image-2": "gpt-image-2",
    },
    generate,
  };
}
