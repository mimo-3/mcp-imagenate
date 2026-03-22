import { GoogleGenAI } from "@google/genai";
import type { GenerateParams, GenerateResult, ProviderRegistration } from "./types.js";

type ContentPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

export function createGoogleProvider(apiKey: string): ProviderRegistration {
  const ai = new GoogleGenAI({ apiKey });

  const generate = async (params: GenerateParams): Promise<GenerateResult> => {
    const contentParts: ContentPart[] = [];

    if (params.inputImages) {
      for (let i = 0; i < params.inputImages.length; i++) {
        contentParts.push({
          inlineData: {
            mimeType: params.inputImageMimeTypes![i],
            data: params.inputImages[i].toString("base64"),
          },
        });
      }
    }
    contentParts.push({ text: params.prompt });

    const responseModalities =
      params.mode === "image" ? ["IMAGE"] : ["TEXT", "IMAGE"];

    const config: Record<string, unknown> = {
      responseModalities,
      imageConfig: {
        imageSize: params.resolution,
        aspectRatio: params.aspectRatio,
      },
      thinkingConfig: {
        thinkingBudget: params.thinking === "none" ? 0 : -1,
      },
    };

    let response;
    try {
      response = await ai.models.generateContent({
        model: params.modelId,
        contents: contentParts.length === 1 ? params.prompt : contentParts,
        config,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("thinking")) {
        const { thinkingConfig: _, ...configWithoutThinking } = config;
        response = await ai.models.generateContent({
          model: params.modelId,
          contents: contentParts.length === 1 ? params.prompt : contentParts,
          config: configWithoutThinking,
        });
      } else {
        throw new Error(`Image generation failed: ${message}`);
      }
    }

    const parts = response.candidates?.[0]?.content?.parts ?? [];
    const images: Buffer[] = [];
    let mimeType = "image/png";
    let description: string | undefined;

    for (const part of parts) {
      if (part.inlineData?.data) {
        mimeType = part.inlineData.mimeType ?? "image/png";
        images.push(Buffer.from(part.inlineData.data, "base64"));
      } else if (typeof part.text === "string" && part.text.trim()) {
        description = (description ?? "") + part.text;
      }
    }

    if (images.length === 0) {
      throw new Error("No images were returned by the model");
    }

    return {
      images,
      mimeType,
      description: description?.trim(),
    };
  };

  return {
    models: {
      "nano-banana-2": "gemini-3.1-flash-image-preview",
      "nano-banana-pro": "gemini-3-pro-image-preview",
    },
    generate,
  };
}
