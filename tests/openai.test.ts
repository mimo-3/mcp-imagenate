import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";

import { createOpenAIProvider } from "../src/providers/openai.js";
import type { Background, GenerateParams } from "../src/providers/types.js";

/** A minimal buffer that still carries a valid PNG signature. */
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

const realFetch = globalThis.fetch;

interface Call {
  url: string;
  /** Request fields, whether they arrived as JSON or as multipart form data. */
  fields: Record<string, unknown>;
}

/**
 * Replace global fetch with one that records every OpenAI API request and
 * replies with a single canned image.
 *
 * The SDK also resolves `toFile` inputs through a `data:` URL, so calls to
 * anything but the API host are answered but not recorded.
 */
function stubFetch(): { calls: Call[] } {
  const calls: Call[] = [];
  globalThis.fetch = (async (url: unknown, init: RequestInit) => {
    const href = String(url);
    if (href.startsWith("https://api.openai.com/")) {
      const body = init?.body;
      const fields =
        body instanceof FormData
          ? Object.fromEntries(body.entries())
          : (JSON.parse(String(body)) as Record<string, unknown>);
      calls.push({ url: href, fields });
    }
    return new Response(
      JSON.stringify({ data: [{ b64_json: PNG.toString("base64") }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as unknown as typeof fetch;
  return { calls };
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

function params(overrides: Partial<GenerateParams> = {}): GenerateParams {
  return {
    prompt: "a calico cat",
    modelId: "gpt-image-2",
    resolution: "1K",
    aspectRatio: "1:1",
    mode: "image",
    thinking: "auto",
    background: "auto",
    ...overrides,
  };
}

describe("createOpenAIProvider", () => {
  it("declares that it can return a transparent background", () => {
    // generateImageToDisk reads this to decide whether to let the request
    // through, so the provider has to advertise it.
    assert.equal(
      createOpenAIProvider("k").supportsTransparentBackground,
      true,
    );
  });

  for (const background of ["auto", "transparent", "opaque"] as Background[]) {
    it(`sends background=${background} to images.generate`, async () => {
      const { calls } = stubFetch();
      await createOpenAIProvider("k").generate(params({ background }));

      assert.equal(calls.length, 1);
      assert.match(calls[0].url, /\/images\/generations$/);
      assert.equal(calls[0].fields.background, background);
      // JPEG cannot carry an alpha channel, so the format stays PNG.
      assert.equal(calls[0].fields.output_format, "png");
    });

    it(`sends background=${background} to images.edit`, async () => {
      const { calls } = stubFetch();
      await createOpenAIProvider("k").generate(
        params({
          background,
          inputImages: [PNG],
          inputImageMimeTypes: ["image/png"],
        }),
      );

      assert.equal(calls.length, 1);
      assert.match(calls[0].url, /\/images\/edits$/);
      assert.equal(calls[0].fields.background, background);
      assert.equal(calls[0].fields.output_format, "png");
    });
  }
});
