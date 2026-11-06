import { describe, it, afterEach, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isBuiltin } from "node:module";

import { createRegistry, keysFromEnv } from "../src/providers/registry.js";

import { createOpenAIProvider } from "../src/providers/openai.js";
import type { Background, GenerateParams } from "../src/providers/types.js";

/** A minimal buffer that still carries a valid PNG signature. */
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

const realFetch = globalThis.fetch;

interface Call {
  url: string;
  key: string;
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
type Reply = Response | undefined;

function stubFetch(reply?: (key: string) => Reply | Promise<Reply>): { calls: Call[] } {
  const calls: Call[] = [];
  globalThis.fetch = (async (url: unknown, init: RequestInit) => {
    const href = String(url);
    if (href.startsWith("https://api.openai.com/")) {
      const body = init?.body;
      const fields =
        body instanceof FormData
          ? Object.fromEntries(body.entries())
          : (JSON.parse(String(body)) as Record<string, unknown>);
      const key = new Headers(init.headers).get("authorization")!.replace(/^Bearer /, "");
      calls.push({ url: href, fields, key });
      const response = await reply?.(key);
      if (response) return response;
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

  for (const modelId of ["gpt-image-2.6-flare", "gpt-image-2.6-sunburst", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"]) {
    it(`sends ${modelId} through to images.generate`, async () => {
      const { calls } = stubFetch();
      await createOpenAIProvider("k").generate(params({ modelId }));

      assert.equal(calls.length, 1);
      assert.match(calls[0].url, /\/images\/generations$/);
      assert.equal(calls[0].fields.model, modelId);
    });

    it(`sends ${modelId} through to images.edit`, async () => {
      const { calls } = stubFetch();
      await createOpenAIProvider("k").generate(
        params({ modelId, inputImages: [PNG], inputImageMimeTypes: ["image/png"] }),
      );

      assert.equal(calls.length, 1);
      assert.match(calls[0].url, /\/images\/edits$/);
      assert.equal(calls[0].fields.model, modelId);
    });
  }

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

function keyFile(t: TestContext, contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), "imagenate-keys-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "keys.json");
  writeFileSync(path, contents);
  return path;
}

describe("OpenAI key file", () => {
  const multiKey = { skip: !isBuiltin("node:sqlite") };
  const depleted = () => Response.json({ error: { code: "credit_balance_exhausted" } }, { status: 429 });
  const model = "gpt-image-2.6-flare";

  it("advances through distinct keys and shares the active key with a new registry", multiKey, async t => {
    const file = keyFile(t, JSON.stringify(["one", "one", "two", "three"]));
    const config = keysFromEnv({ OPENAI_API_KEY: "unused", GPT_IMAGE_API_KEYS_FILE: file });
    let working = "three";
    const { calls } = stubFetch(key => key === working ? undefined : depleted());
    await createRegistry(config).resolve(model).generate(params());
    await createRegistry(config).resolve(model).generate(params({ inputImages: [PNG] }));
    working = "one";
    await createRegistry(config).resolve(model).generate(params());
    assert.deepEqual(calls.map(c => c.key), ["one", "two", "three", "three", "three", "one"]);
    assert.match(calls[3].url, /\/images\/edits$/);
  });

  it("stops after one pass and propagates rate limits on the active key", multiKey, async t => {
    const file = keyFile(t, JSON.stringify(["one", "two", "three"]));
    const { calls } = stubFetch(depleted);
    const provider = createRegistry({ openaiKeysFile: file }).resolve(model);
    await assert.rejects(provider.generate(params()));
    assert.deepEqual(calls.map(c => c.key), ["one", "two", "three"]);
    const limited = stubFetch(() => Response.json({ error: { code: "rate_limit_exceeded" } }, { status: 429 }));
    // The SDK captures fetch when constructing the client.
    await assert.rejects(createRegistry({ openaiKeysFile: file }).resolve(model).generate(params()));
    assert.deepEqual(limited.calls.map(c => c.key), ["three"]);
  });

  it("advances only once when two requests exhaust the same active key", { ...multiKey, timeout: 5000 }, async t => {
    const file = keyFile(t, JSON.stringify(["one", "two", "three"]));
    let release!: () => void;
    const bothStarted = new Promise<void>(resolve => { release = resolve; });
    let arrivals = 0;
    const { calls } = stubFetch(async key => {
      if (key !== "one") return undefined;
      if (++arrivals === 2) release();
      await bothStarted;
      return depleted();
    });
    const generate = () => createRegistry({ openaiKeysFile: file }).resolve(model).generate(params());
    await Promise.all([generate(), generate()]);
    await generate();
    assert.deepEqual(calls.map(c => c.key).sort(), ["one", "one", "two", "two", "two"]);
  });

  it("rejects invalid key files without including their contents in errors", t => {
    for (const value of ['["example-secret"', '["example-secret", " "]', '[]', '{}']) {
      const file = keyFile(t, value);
      assert.throws(() => createRegistry({ openaiKeysFile: file, openai: "unused" }), error =>
        error instanceof Error && error.message.includes("GPT_IMAGE_API_KEYS_FILE") &&
        !error.message.includes("example-secret"));
    }
  });
});
