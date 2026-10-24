import { afterEach, it } from "node:test";
import assert from "node:assert/strict";
import type { Content, GenerationConfig } from "@google/genai";
import { createGoogleProvider } from "../src/providers/google.js";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

it("preserves generateContent image inputs and settings with GenAI 2", async () => {
  const calls: Array<{ contents: Content[]; generationConfig: GenerationConfig }> = [];
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [
      { inlineData: { data: Buffer.from("deps-image").toString("base64"), mimeType: "image/png" } },
      { text: " a cat " },
    ] } }] }), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  const result = await createGoogleProvider("deps-test-key").generate({
    prompt: "a cat", modelId: "gemini-3.1-flash-image-preview",
    resolution: "2K", aspectRatio: "16:9", mode: "image_and_text", thinking: "none", background: "auto",
    inputImages: [Buffer.from("deps-input")], inputImageMimeTypes: ["image/jpeg"],
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].contents[0].parts, [
    { inlineData: { mimeType: "image/jpeg", data: Buffer.from("deps-input").toString("base64") } },
    { text: "a cat" },
  ]);
  assert.deepEqual(calls[0].generationConfig, {
    responseModalities: ["TEXT", "IMAGE"],
    imageConfig: { imageSize: "2K", aspectRatio: "16:9" },
    thinkingConfig: { thinkingBudget: 0 },
  });
  assert.deepEqual(result.images, [Buffer.from("deps-image")]);
  assert.equal(result.mimeType, "image/png");
  assert.equal(result.description, "a cat");
});
