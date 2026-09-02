import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createOmniVideoProvider } from "../src/providers/omni-video.js";
import type { VideoGenerateParams } from "../src/providers/video-types.js";

const MP4 = Buffer.from("fake-mp4-bytes");

function baseParams(overrides: Partial<VideoGenerateParams> = {}): VideoGenerateParams {
  return {
    prompt: "a balloon",
    modelId: "gemini-omni-1.1-flash",
    durationSeconds: 4,
    resolution: "720p",
    aspectRatio: "16:9",
    ...overrides,
  };
}

function interactionJson(content: Record<string, unknown>[], extra: Record<string, unknown> = {}) {
  return {
    id: "v1_abc",
    status: "completed",
    steps: [
      { type: "thought" },
      { type: "model_output", content },
    ],
    ...extra,
  };
}

/** A fetch stand-in that records calls and answers from a queue. */
function fakeFetch(responses: Array<() => Response>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const next = responses.shift();
    if (!next) throw new Error("fakeFetch: no response queued");
    return next();
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("createOmniVideoProvider", () => {
  it("registers gemini-omni-1.1-flash against the Omni 1.1 model id with the 3–10 s range", () => {
    const reg = createOmniVideoProvider("key");
    assert.deepEqual(reg.models, { "gemini-omni-1.1-flash": "gemini-omni-1.1-flash" });
    assert.equal(reg.minDurationSeconds, 3);
    assert.equal(reg.maxDurationSeconds, 10);
  });

  it("posts to the interactions endpoint and still accepts an inline clip", async () => {
    const { fetchImpl, calls } = fakeFetch([
      () => json(interactionJson([{ type: "video", data: MP4.toString("base64"), mime_type: "video/mp4" }])),
    ]);
    const reg = createOmniVideoProvider("secret", { fetch: fetchImpl });

    const result = await reg.generate(baseParams({ aspectRatio: "9:16", resolution: "360p" }));

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://generativelanguage.googleapis.com/v1beta/interactions");
    assert.equal(calls[0].init?.method, "POST");
    assert.equal((calls[0].init?.headers as Record<string, string>)["x-goog-api-key"], "secret");
    const body = JSON.parse(String(calls[0].init?.body));
    assert.equal(body.model, "gemini-omni-1.1-flash");
    assert.equal(body.input, "a balloon");
    assert.deepEqual(body.response_format, {
      type: "video",
      duration: "4s",
      resolution: "360p",
      aspect_ratio: "9:16",
      delivery: "uri",
    });
    assert.equal("previous_interaction_id" in body, false);
    assert.deepEqual(result.video, MP4);
    assert.equal(result.mimeType, "video/mp4");
    assert.equal(result.interactionId, "v1_abc");
  });

  it("sends reference images ahead of the prompt as typed parts", async () => {
    const { fetchImpl, calls } = fakeFetch([
      () => json(interactionJson([{ type: "video", data: MP4.toString("base64") }])),
    ]);
    const reg = createOmniVideoProvider("k", { fetch: fetchImpl });

    await reg.generate(
      baseParams({
        inputImages: [Buffer.from("png1"), Buffer.from("jpg2")],
        inputImageMimeTypes: ["image/png", "image/jpeg"],
      }),
    );

    const body = JSON.parse(String(calls[0].init?.body));
    assert.deepEqual(body.input, [
      { type: "image", data: Buffer.from("png1").toString("base64"), mime_type: "image/png" },
      { type: "image", data: Buffer.from("jpg2").toString("base64"), mime_type: "image/jpeg" },
      { type: "text", text: "a balloon" },
    ]);
  });

  it("rejects mismatched input image mime types before calling the API", async () => {
    const { fetchImpl, calls } = fakeFetch([]);
    const reg = createOmniVideoProvider("k", { fetch: fetchImpl });
    await assert.rejects(
      reg.generate(baseParams({ inputImages: [Buffer.from("x")], inputImageMimeTypes: [] })),
      /inputImageMimeTypes/,
    );
    assert.equal(calls.length, 0);
  });

  it("downloads a uri-delivered clip with the key header", async () => {
    const { fetchImpl, calls } = fakeFetch([
      () =>
        json(
          interactionJson([
            { type: "video", uri: "https://files.example/abc:download?alt=media", mime_type: "video/mp4" },
          ]),
        ),
      () => new Response(MP4, { status: 200 }),
    ]);
    const reg = createOmniVideoProvider("secret", { fetch: fetchImpl });

    const result = await reg.generate(baseParams({ durationSeconds: 8 }));

    const body = JSON.parse(String(calls[0].init?.body));
    assert.equal(body.response_format.duration, "8s");
    assert.equal(calls[1].url, "https://files.example/abc:download?alt=media");
    assert.equal((calls[1].init?.headers as Record<string, string>)["x-goog-api-key"], "secret");
    assert.deepEqual(result.video, MP4);
  });

  it("passes previous_interaction_id through for extensions", async () => {
    const { fetchImpl, calls } = fakeFetch([
      () => json(interactionJson([{ type: "video", data: MP4.toString("base64") }])),
    ]);
    const reg = createOmniVideoProvider("k", { fetch: fetchImpl });

    await reg.generate(baseParams({ previousInteractionId: "v1_prev" }));

    const body = JSON.parse(String(calls[0].init?.body));
    assert.equal(body.previous_interaction_id, "v1_prev");
  });

  it("collects text returned alongside the clip as the description", async () => {
    const { fetchImpl } = fakeFetch([
      () =>
        json(
          interactionJson([
            { type: "text", text: "A red balloon " },
            { type: "text", text: "rises." },
            { type: "video", data: MP4.toString("base64") },
          ]),
        ),
    ]);
    const reg = createOmniVideoProvider("k", { fetch: fetchImpl });
    const result = await reg.generate(baseParams());
    assert.equal(result.description, "A red balloon rises.");
  });

  it("surfaces the API error message on a non-2xx response", async () => {
    const { fetchImpl } = fakeFetch([
      () => json({ error: { message: "This model only supports Interactions API.", code: "invalid_request" } }, 400),
    ]);
    const reg = createOmniVideoProvider("k", { fetch: fetchImpl });
    await assert.rejects(
      reg.generate(baseParams()),
      /Gemini Omni request failed \(400\): This model only supports Interactions API\./,
    );
  });

  it("fails clearly when the interaction completes without a video", async () => {
    const { fetchImpl } = fakeFetch([
      () => json(interactionJson([{ type: "text", text: "I cannot do that." }])),
    ]);
    const reg = createOmniVideoProvider("k", { fetch: fetchImpl });
    await assert.rejects(reg.generate(baseParams()), /No video was returned/);
  });

  it("fails when the download behind a uri is refused", async () => {
    const { fetchImpl } = fakeFetch([
      () => json(interactionJson([{ type: "video", uri: "https://files.example/x" }])),
      () => new Response("forbidden", { status: 403 }),
    ]);
    const reg = createOmniVideoProvider("k", { fetch: fetchImpl });
    await assert.rejects(reg.generate(baseParams()), /video download failed \(403\): forbidden/);
  });

  it("honours a custom base url without doubling the slash", async () => {
    const { fetchImpl, calls } = fakeFetch([
      () => json(interactionJson([{ type: "video", data: MP4.toString("base64") }])),
    ]);
    const reg = createOmniVideoProvider("k", { fetch: fetchImpl, baseUrl: "http://localhost:9/v1beta/" });
    await reg.generate(baseParams());
    assert.equal(calls[0].url, "http://localhost:9/v1beta/interactions");
  });
});
