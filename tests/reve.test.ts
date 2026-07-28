import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";

import { createReveProvider, readBoundedText } from "../src/providers/reve.js";
import type { GenerateParams } from "../src/providers/types.js";

/** Build a Response-like object whose body streams the given chunks. */
function streamingResponse(
  chunks: Uint8Array[],
  headers: Record<string, string> = {},
): { response: Response; cancelled: () => boolean } {
  let cancelled = false;
  let index = 0;
  const body = {
    getReader: () => ({
      read: async () =>
        index < chunks.length
          ? { done: false, value: chunks[index++] }
          : { done: true, value: undefined },
      cancel: async () => {
        cancelled = true;
      },
    }),
    cancel: async () => {
      cancelled = true;
    },
  };
  const response = {
    ok: true,
    status: 200,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    body,
  } as unknown as Response;
  return { response, cancelled: () => cancelled };
}

const bytes = (n: number) => new Uint8Array(n).fill(0x61);

const realFetch = globalThis.fetch;

interface Call {
  url: string;
  init: RequestInit;
  body: Record<string, unknown>;
}

/**
 * Replace global fetch with one that records the request and replies with the
 * given payload. Returns the recorded calls.
 */
function stubFetch(
  status: number,
  payload: unknown,
  headers: Record<string, string> = {},
): { calls: Call[] } {
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init, body: JSON.parse(String(init.body)) });
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
      text: async () => JSON.stringify(payload),
    };
  }) as unknown as typeof fetch;
  return { calls };
}

/** A minimal buffer that still carries a valid PNG signature. */
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const PNG_B64 = PNG.toString("base64");

function params(overrides: Partial<GenerateParams> = {}): GenerateParams {
  return {
    prompt: "a calico cat",
    modelId: "latest",
    resolution: "1K",
    aspectRatio: "16:9",
    mode: "image",
    thinking: "auto",
    ...overrides,
  };
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("createReveProvider", () => {
  it("exposes the reve-image model", () => {
    const provider = createReveProvider("k");
    assert.deepEqual(Object.keys(provider.models), ["reve-image"]);
    assert.equal(typeof provider.generate, "function");
  });

  it("posts prompt, version and aspect ratio to the create endpoint", async () => {
    const { calls } = stubFetch(200, { image: PNG_B64 });
    const result = await createReveProvider("secret").generate(params());

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.reve.com/v2/image/create");
    assert.deepEqual(calls[0].body, {
      prompt: "a calico cat",
      version: "latest",
      aspect_ratio: "16:9",
    });
    assert.deepEqual(result.images, [PNG]);
    assert.equal(result.mimeType, "image/png");
  });

  it("authenticates with a bearer token", async () => {
    const { calls } = stubFetch(200, { image: PNG_B64 });
    await createReveProvider("secret").generate(params());

    const headers = calls[0].init.headers as Record<string, string>;
    assert.equal(headers.authorization, "Bearer secret");
  });

  it("passes an abort signal and maps a body-stage timeout onto it", async () => {
    // Asserted together on purpose: a timeout that surfaces while the stream is
    // being read is only reachable because the signal reached fetch, so
    // checking the two separately would let a broken hand-off pass both.
    let seen: RequestInit | undefined;
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      seen = init;
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        body: {
          getReader: () => ({
            read: async () => {
              if (!(init.signal instanceof AbortSignal)) {
                throw new Error("fetch was called without an abort signal");
              }
              const err = new Error("The operation was aborted due to timeout");
              err.name = "TimeoutError";
              throw err;
            },
            cancel: async () => {},
          }),
          cancel: async () => {},
        },
      };
    }) as unknown as typeof fetch;

    await assert.rejects(
      () => createReveProvider("k").generate(params()),
      /Reve did not respond within 300s/,
    );
    assert.ok(seen?.signal instanceof AbortSignal);
  });

  it("refuses a response whose declared length is over the limit", async () => {
    stubFetch(200, { image: PNG_B64 }, { "content-length": String(65 * 1024 * 1024) });
    await assert.rejects(
      () => createReveProvider("k").generate(params()),
      /over this client's \d+ byte limit/,
    );
  });

  it("sends input images as base64 references on the same endpoint", async () => {
    const { calls } = stubFetch(200, { image: PNG_B64 });
    await createReveProvider("k").generate(
      params({
        inputImages: [PNG, Buffer.from("second")],
        inputImageMimeTypes: ["image/png", "image/png"],
      }),
    );

    assert.equal(calls[0].url, "https://api.reve.com/v2/image/create");
    assert.deepEqual(calls[0].body.references, [
      { data: PNG_B64 },
      { data: Buffer.from("second").toString("base64") },
    ]);
  });

  it("omits references entirely when there are no input images", async () => {
    const { calls } = stubFetch(200, { image: PNG_B64 });
    await createReveProvider("k").generate(params());
    assert.equal("references" in calls[0].body, false);
  });

  it("accepts the maximum of eight references", async () => {
    const { calls } = stubFetch(200, { image: PNG_B64 });
    await createReveProvider("k").generate(
      params({ inputImages: Array.from({ length: 8 }, () => PNG) }),
    );
    assert.equal((calls[0].body.references as unknown[]).length, 8);
  });

  it("rejects a ninth reference before reaching the network", async () => {
    const { calls } = stubFetch(200, { image: PNG_B64 });
    await assert.rejects(
      () =>
        createReveProvider("k").generate(
          params({ inputImages: Array.from({ length: 9 }, () => PNG) }),
        ),
      /accepts at most 8 input images \(got 9\)/,
    );
    assert.equal(calls.length, 0);
  });

  it("passes 21:9 through, which v2 accepts", async () => {
    const { calls } = stubFetch(200, { image: PNG_B64 });
    await createReveProvider("k").generate(params({ aspectRatio: "21:9" }));
    assert.equal(calls[0].body.aspect_ratio, "21:9");
  });

  it("rejects an over-long prompt before spending a request", async () => {
    const { calls } = stubFetch(200, { image: PNG_B64 });
    await assert.rejects(
      () => createReveProvider("k").generate(params({ prompt: "a".repeat(4001) })),
      /exceeds the 4,000 character limit/,
    );
    assert.equal(calls.length, 0);
  });

  it("counts prompt length in code points, not UTF-16 units", async () => {
    // 4,000 emoji are 8,000 UTF-16 units but only 4,000 characters.
    const { calls } = stubFetch(200, { image: PNG_B64 });
    await createReveProvider("k").generate(params({ prompt: "🐈".repeat(4000) }));
    assert.equal(calls.length, 1);
  });

  it("publishes its input-image limit so callers can check before reading files", () => {
    assert.equal(createReveProvider("k").maxInputImages, 8);
  });
});

describe("reve response handling", () => {
  it("strips a data URI prefix when the API returns one", async () => {
    stubFetch(200, { image: `data:image/png;base64,${PNG_B64}` });
    const result = await createReveProvider("k").generate(params());
    assert.deepEqual(result.images, [PNG]);
  });

  it("rejects a data URI that is not an image", async () => {
    stubFetch(200, { image: `data:text/plain;base64,${PNG_B64}` });
    await assert.rejects(
      () => createReveProvider("k").generate(params()),
      /unsupported encoding/,
    );
  });

  it("rejects base64 that Node would otherwise decode by skipping junk", async () => {
    stubFetch(200, { image: "%%%%" });
    await assert.rejects(
      () => createReveProvider("k").generate(params()),
      /malformed base64/,
    );
  });

  it("rejects a truncated payload Node would silently shorten", async () => {
    // A trailing partial group: Node drops it and returns a valid-looking but
    // incomplete image, so the length has to be checked before decoding.
    stubFetch(200, { image: `${PNG_B64}A` });
    await assert.rejects(
      () => createReveProvider("k").generate(params()),
      /malformed base64/,
    );
  });

  it("rejects a well-formed base64 payload that is not an image", async () => {
    stubFetch(200, { image: Buffer.from("not an image!!!!").toString("base64") });
    await assert.rejects(
      () => createReveProvider("k").generate(params()),
      /not a PNG, JPEG or WebP image/,
    );
  });

  it("reports JPEG and WebP results with their real MIME type", async () => {
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(5)]);
    stubFetch(200, { image: jpeg.toString("base64") });
    assert.equal(
      (await createReveProvider("k").generate(params())).mimeType,
      "image/jpeg",
    );

    const webp = Buffer.concat([
      Buffer.from("RIFF", "ascii"),
      Buffer.alloc(4),
      Buffer.from("WEBP", "ascii"),
    ]);
    stubFetch(200, { image: webp.toString("base64") });
    assert.equal(
      (await createReveProvider("k").generate(params())).mimeType,
      "image/webp",
    );
  });

  it("identifies the container without claiming the image is well formed", async () => {
    // A PNG header with no IHDR/IDAT/IEND still picks the right extension,
    // which is all this check is for.
    stubFetch(200, { image: PNG_B64 });
    assert.equal(
      (await createReveProvider("k").generate(params())).mimeType,
      "image/png",
    );
  });

  it("does not call something WebP just because WEBP appears at offset 8", async () => {
    // WebP is a RIFF container: the form type alone is not enough.
    const notWebp = Buffer.concat([
      Buffer.from("NOTR", "ascii"),
      Buffer.alloc(4),
      Buffer.from("WEBP", "ascii"),
    ]);
    stubFetch(200, { image: notWebp.toString("base64") });
    await assert.rejects(
      () => createReveProvider("k").generate(params()),
      /not a PNG, JPEG or WebP image/,
    );
  });

  it("rejects a non-string image field instead of throwing a TypeError", async () => {
    stubFetch(200, { image: {} });
    await assert.rejects(
      () => createReveProvider("k").generate(params()),
      /no usable image data/,
    );
  });

  it("errors when no image comes back", async () => {
    stubFetch(200, { request_id: "abc" });
    await assert.rejects(
      () => createReveProvider("k").generate(params()),
      /no usable image data/,
    );
  });

  it("reports a content policy refusal rather than an empty image", async () => {
    stubFetch(200, { content_violation: true });
    await assert.rejects(
      () => createReveProvider("k").generate(params()),
      /content policy violation/,
    );
  });
});

describe("readBoundedText", () => {
  it("reads a body that stays within the limit", async () => {
    const { response } = streamingResponse([bytes(4), bytes(6)]);
    assert.equal((await readBoundedText(response, 10)).length, 10);
  });

  it("stops one byte over the limit and cancels the reader", async () => {
    const { response, cancelled } = streamingResponse([bytes(10), bytes(1)]);
    await assert.rejects(
      () => readBoundedText(response, 10),
      /exceeded this client's 10 byte limit/,
    );
    assert.ok(cancelled(), "reader was left open");
  });

  it("enforces the limit when no content-length is declared", async () => {
    const { response, cancelled } = streamingResponse([bytes(50)]);
    await assert.rejects(() => readBoundedText(response, 10), /exceeded/);
    assert.ok(cancelled());
  });

  it("enforces the limit when content-length under-declares the body", async () => {
    const { response, cancelled } = streamingResponse([bytes(50)], {
      "content-length": "5",
    });
    await assert.rejects(() => readBoundedText(response, 10), /exceeded/);
    assert.ok(cancelled());
  });

  it("cancels the body instead of leaking it when the declared length is too big", async () => {
    const { response, cancelled } = streamingResponse([bytes(1)], {
      "content-length": "999",
    });
    await assert.rejects(
      () => readBoundedText(response, 10),
      /over this client's 10 byte limit/,
    );
    assert.ok(cancelled(), "body was not discarded");
  });

  it("does not split a multi-byte character across chunk boundaries", async () => {
    const emoji = new TextEncoder().encode("🐈");
    const { response } = streamingResponse([
      emoji.subarray(0, 2),
      emoji.subarray(2),
    ]);
    assert.equal(await readBoundedText(response, 10), "🐈");
  });
});

describe("reve error reporting", () => {
  it("surfaces the API error code and message", async () => {
    stubFetch(401, {
      error_code: "PARTNER_API_TOKEN_INVALID",
      message: "Invalid partner API bearer token.",
    });
    await assert.rejects(
      () => createReveProvider("bad").generate(params()),
      /Reve create failed: 401 \(PARTNER_API_TOKEN_INVALID\) Invalid partner API bearer token\./,
    );
  });

  it("includes the request id Reve support asks for", async () => {
    stubFetch(500, { message: "boom" }, { "x-reve-request-id": "rsid-123" });
    await assert.rejects(
      () => createReveProvider("k").generate(params()),
      /\[request rsid-123\]/,
    );
  });

  it("truncates and flattens a hostile error message", async () => {
    const hostile = `line one\nline two\u001b[31m${"x".repeat(500)}`;
    stubFetch(500, { message: hostile });
    await assert.rejects(() => createReveProvider("k").generate(params()), (err: Error) => {
      assert.ok(
        !/[\u0000-\u001f\u007f]/.test(err.message),
        "control characters survived",
      );
      assert.ok(err.message.length < 300, `message not truncated: ${err.message.length}`);
      return true;
    });
  });
});
