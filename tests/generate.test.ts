import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { generateImageToDisk } from "../src/generate.js";
import type { GenerateParams, GenerateResult } from "../src/providers/types.js";
import type { ImageRegistry } from "../src/providers/registry.js";

/** A registry that records what it was asked for and returns canned bytes. */
function fakeRegistry(
  result: Partial<GenerateResult> = {},
  onCall?: (params: GenerateParams) => void,
): ImageRegistry {
  return {
    models: ["fake-model"],
    defaultModel: "fake-model",
    resolve(name: string) {
      if (name !== "fake-model") throw new Error(`Unknown model: ${name}`);
      return {
        modelId: "fake-model-v1",
        generate: async (params) => {
          onCall?.(params);
          return {
            images: result.images ?? [Buffer.from("fake-png-bytes")],
            mimeType: result.mimeType ?? "image/png",
            ...(result.description ? { description: result.description } : {}),
          };
        },
      };
    },
  };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-imagenate-gen-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("generateImageToDisk", () => {
  it("writes the returned image and reports its path", async () => {
    const outcome = await generateImageToDisk({
      registry: fakeRegistry(),
      prompt: "a cat",
      model: "fake-model",
      outputDir: tmpDir,
    });

    assert.equal(outcome.savedFiles.length, 1);
    assert.equal(path.dirname(outcome.savedFiles[0]), tmpDir);
    assert.equal(fs.readFileSync(outcome.savedFiles[0], "utf8"), "fake-png-bytes");
  });

  it("reports the provider model id, not the friendly name", async () => {
    const outcome = await generateImageToDisk({
      registry: fakeRegistry(),
      prompt: "a cat",
      model: "fake-model",
      outputDir: tmpDir,
    });
    assert.equal(outcome.model, "fake-model-v1");
  });

  it("picks the extension from the returned mime type", async () => {
    const outcome = await generateImageToDisk({
      registry: fakeRegistry({ mimeType: "image/jpeg" }),
      prompt: "a cat",
      model: "fake-model",
      outputDir: tmpDir,
    });
    assert.equal(path.extname(outcome.savedFiles[0]), ".jpg");
  });

  it("falls back to .png for an unfamiliar mime type", async () => {
    const outcome = await generateImageToDisk({
      registry: fakeRegistry({ mimeType: "image/avif" }),
      prompt: "a cat",
      model: "fake-model",
      outputDir: tmpDir,
    });
    assert.equal(path.extname(outcome.savedFiles[0]), ".png");
  });

  it("writes every image when the provider returns several", async () => {
    const outcome = await generateImageToDisk({
      registry: fakeRegistry({ images: [Buffer.from("one"), Buffer.from("two")] }),
      prompt: "a cat",
      model: "fake-model",
      outputDir: tmpDir,
    });
    assert.equal(outcome.savedFiles.length, 2);
    assert.equal(new Set(outcome.savedFiles).size, 2, "filenames must be unique");
  });

  it("creates the output directory when it does not exist", async () => {
    const nested = path.join(tmpDir, "a", "b");
    const outcome = await generateImageToDisk({
      registry: fakeRegistry(),
      prompt: "a cat",
      model: "fake-model",
      outputDir: nested,
    });
    assert.equal(path.dirname(outcome.savedFiles[0]), nested);
  });

  it("passes the requested settings through to the provider", async () => {
    let seen: GenerateParams | undefined;
    await generateImageToDisk({
      registry: fakeRegistry({}, (p) => {
        seen = p;
      }),
      prompt: "a cat",
      model: "fake-model",
      resolution: "2K",
      aspectRatio: "16:9",
      mode: "image_and_text",
      thinking: "none",
      outputDir: tmpDir,
    });
    assert.equal(seen?.resolution, "2K");
    assert.equal(seen?.aspectRatio, "16:9");
    assert.equal(seen?.mode, "image_and_text");
    assert.equal(seen?.thinking, "none");
  });

  it("defaults to 1K / 1:1 / image when nothing is specified", async () => {
    let seen: GenerateParams | undefined;
    const outcome = await generateImageToDisk({
      registry: fakeRegistry({}, (p) => {
        seen = p;
      }),
      prompt: "a cat",
      model: "fake-model",
      outputDir: tmpDir,
    });
    assert.equal(seen?.resolution, "1K");
    assert.equal(seen?.aspectRatio, "1:1");
    assert.deepEqual(outcome.settings, {
      resolution: "1K",
      aspectRatio: "1:1",
      mode: "image",
    });
  });

  it("returns the description only when the provider supplies one", async () => {
    const without = await generateImageToDisk({
      registry: fakeRegistry(),
      prompt: "a cat",
      model: "fake-model",
      outputDir: tmpDir,
    });
    assert.equal("description" in without, false);

    const with_ = await generateImageToDisk({
      registry: fakeRegistry({ description: "a napping cat" }),
      prompt: "a cat",
      model: "fake-model",
      outputDir: tmpDir,
    });
    assert.equal(with_.description, "a napping cat");
  });

  it("surfaces an unknown model without writing anything", async () => {
    await assert.rejects(
      generateImageToDisk({
        registry: fakeRegistry(),
        prompt: "a cat",
        model: "nope",
        outputDir: tmpDir,
      }),
      /Unknown model: nope/,
    );
    assert.deepEqual(fs.readdirSync(tmpDir), []);
  });

  it("reads and forwards input images with their mime types", async () => {
    const input = path.join(tmpDir, "ref.png");
    fs.writeFileSync(input, Buffer.from("reference-bytes"));

    let seen: GenerateParams | undefined;
    await generateImageToDisk({
      registry: fakeRegistry({}, (p) => {
        seen = p;
      }),
      prompt: "a cat",
      model: "fake-model",
      outputDir: tmpDir,
      inputImages: [input],
    });
    assert.equal(seen?.inputImages?.length, 1);
    assert.equal(seen?.inputImages?.[0].toString(), "reference-bytes");
    assert.deepEqual(seen?.inputImageMimeTypes, ["image/png"]);
  });

  it("rejects an input image with an unsupported extension", async () => {
    const input = path.join(tmpDir, "notes.txt");
    fs.writeFileSync(input, "hello");
    await assert.rejects(
      generateImageToDisk({
        registry: fakeRegistry(),
        prompt: "a cat",
        model: "fake-model",
        outputDir: tmpDir,
        inputImages: [input],
      }),
      /Unsupported input image format/,
    );
  });

  it("rejects a directory passed as an input image", async () => {
    const dir = path.join(tmpDir, "dir.png");
    fs.mkdirSync(dir);
    await assert.rejects(
      generateImageToDisk({
        registry: fakeRegistry(),
        prompt: "a cat",
        model: "fake-model",
        outputDir: tmpDir,
        inputImages: [dir],
      }),
      /is not a file/,
    );
  });

  describe("with a sandbox base", () => {
    it("keeps an output path inside the base", async () => {
      const outcome = await generateImageToDisk({
        registry: fakeRegistry(),
        prompt: "a cat",
        model: "fake-model",
        outputDir: "sub",
        outputBaseDir: tmpDir,
      });
      assert.equal(path.dirname(outcome.savedFiles[0]), path.join(tmpDir, "sub"));
    });

    it("refuses an output path that escapes the base", async () => {
      await assert.rejects(
        generateImageToDisk({
          registry: fakeRegistry(),
          prompt: "a cat",
          model: "fake-model",
          outputDir: "../escape",
          outputBaseDir: tmpDir,
        }),
        /outside the allowed base directory/,
      );
    });

    it("refuses an input image from outside the base", async () => {
      const outside = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-imagenate-out-"));
      const input = path.join(outside, "ref.png");
      fs.writeFileSync(input, Buffer.from("x"));
      try {
        await assert.rejects(
          generateImageToDisk({
            registry: fakeRegistry(),
            prompt: "a cat",
            model: "fake-model",
            outputDir: ".",
            outputBaseDir: tmpDir,
            inputImages: [input],
          }),
          /outside the allowed base directory/,
        );
      } finally {
        fs.rmSync(outside, { recursive: true, force: true });
      }
    });

    it("allows any path when no base is given", async () => {
      const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-imagenate-any-"));
      try {
        const outcome = await generateImageToDisk({
          registry: fakeRegistry(),
          prompt: "a cat",
          model: "fake-model",
          outputDir: elsewhere,
        });
        assert.equal(path.dirname(outcome.savedFiles[0]), elsewhere);
      } finally {
        fs.rmSync(elsewhere, { recursive: true, force: true });
      }
    });
  });

  describe("provider input-image limits", () => {
    /** A registry whose model caps input images, like Reve's does. */
    function cappedRegistry(maxInputImages: number): ImageRegistry {
      const base = fakeRegistry();
      return {
        ...base,
        resolve(name: string) {
          return { ...base.resolve(name), maxInputImages };
        },
      };
    }

    it("rejects too many input images without reading any of them", async () => {
      // Every path is nonexistent: if the limit were enforced after reading,
      // the failure would be a filesystem error instead of the limit message.
      await assert.rejects(
        () =>
          generateImageToDisk({
            registry: cappedRegistry(2),
            prompt: "a cat",
            model: "fake-model",
            outputDir: tmpDir,
            inputImages: ["/nope/a.png", "/nope/b.png", "/nope/c.png"],
          }),
        /fake-model accepts at most 2 input images \(got 3\)/,
      );
    });

    it("leaves a request at the limit alone", async () => {
      const image = path.join(tmpDir, "in.png");
      fs.writeFileSync(image, Buffer.from("fake"));
      const outcome = await generateImageToDisk({
        registry: cappedRegistry(2),
        prompt: "a cat",
        model: "fake-model",
        outputDir: tmpDir,
        inputImages: [image, image],
      });
      assert.equal(outcome.savedFiles.length, 1);
    });
  });
});
