import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { generateVideoToDisk } from "../src/generate-video.js";
import type { VideoRegistry } from "../src/providers/video-registry.js";
import type { VideoGenerateParams, VideoGenerateResult } from "../src/providers/video-types.js";

function fakeRegistry(
  result: Partial<VideoGenerateResult> = {},
  onCall?: (params: VideoGenerateParams) => void,
  limits: { maxInputImages?: number } = {},
): VideoRegistry {
  return {
    models: ["fake-video"],
    defaultModel: "fake-video",
    resolve(name: string) {
      if (name !== "fake-video") throw new Error(`Unknown video model: ${name}`);
      return {
        modelId: "fake-video-v1",
        minDurationSeconds: 3,
        maxDurationSeconds: 10,
        ...limits,
        generate: async (params) => {
          onCall?.(params);
          return {
            video: result.video ?? Buffer.from("fake-mp4-bytes"),
            mimeType: result.mimeType ?? "video/mp4",
            ...(result.description ? { description: result.description } : {}),
            ...(result.interactionId ? { interactionId: result.interactionId } : {}),
          };
        },
      };
    },
  };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-imagenate-video-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("generateVideoToDisk", () => {
  it("writes the clip as .mp4 and reports the provider model id", async () => {
    const outcome = await generateVideoToDisk({
      registry: fakeRegistry(),
      prompt: "a cat",
      model: "fake-video",
      outputDir: tmpDir,
    });

    assert.equal(path.dirname(outcome.savedFile), tmpDir);
    assert.equal(path.extname(outcome.savedFile), ".mp4");
    assert.equal(fs.readFileSync(outcome.savedFile, "utf8"), "fake-mp4-bytes");
    assert.equal(outcome.model, "fake-video-v1");
  });

  it("applies the defaults and passes them to the provider", async () => {
    let seen: VideoGenerateParams | undefined;
    const outcome = await generateVideoToDisk({
      registry: fakeRegistry({}, (p) => (seen = p)),
      prompt: "a cat",
      model: "fake-video",
      outputDir: tmpDir,
    });

    assert.deepEqual(outcome.settings, { durationSeconds: 5, resolution: "720p", aspectRatio: "16:9" });
    assert.equal(seen?.durationSeconds, 5);
    assert.equal(seen?.resolution, "720p");
    assert.equal(seen?.aspectRatio, "16:9");
    assert.equal(seen?.inputImages, undefined);
    assert.equal(seen?.previousInteractionId, undefined);
  });

  it("rejects a duration outside the model's range before calling the provider", async () => {
    let called = false;
    for (const durationSeconds of [2, 11, 4.5]) {
      await assert.rejects(
        generateVideoToDisk({
          registry: fakeRegistry({}, () => (called = true)),
          prompt: "a cat",
          model: "fake-video",
          durationSeconds,
          outputDir: tmpDir,
        }),
        /3–10 whole seconds/,
      );
    }
    assert.equal(called, false);
  });

  it("rejects too many input images before reading any", async () => {
    await assert.rejects(
      generateVideoToDisk({
        registry: fakeRegistry({}, undefined, { maxInputImages: 1 }),
        prompt: "a cat",
        model: "fake-video",
        outputDir: tmpDir,
        inputImages: ["/nope/a.png", "/nope/b.png"],
      }),
      /at most 1 input images \(got 2\)/,
    );
  });

  it("reads reference images and forwards them with mime types", async () => {
    const ref = path.join(tmpDir, "ref.png");
    fs.writeFileSync(ref, "png-bytes");
    let seen: VideoGenerateParams | undefined;

    await generateVideoToDisk({
      registry: fakeRegistry({}, (p) => (seen = p)),
      prompt: "animate <IMAGE_REF_1>",
      model: "fake-video",
      outputDir: tmpDir,
      inputImages: [ref],
    });

    assert.equal(seen?.inputImages?.length, 1);
    assert.equal(seen?.inputImages?.[0].toString("utf8"), "png-bytes");
    assert.deepEqual(seen?.inputImageMimeTypes, ["image/png"]);
  });

  it("passes previousInteractionId through and returns the new interactionId", async () => {
    let seen: VideoGenerateParams | undefined;
    const outcome = await generateVideoToDisk({
      registry: fakeRegistry({ interactionId: "v1_new", description: "It rises." }, (p) => (seen = p)),
      prompt: "and then",
      model: "fake-video",
      outputDir: tmpDir,
      previousInteractionId: "v1_old",
    });

    assert.equal(seen?.previousInteractionId, "v1_old");
    assert.equal(outcome.interactionId, "v1_new");
    assert.equal(outcome.description, "It rises.");
  });

  it("keeps output inside the sandbox base", async () => {
    await assert.rejects(
      generateVideoToDisk({
        registry: fakeRegistry(),
        prompt: "a cat",
        model: "fake-video",
        outputDir: "../escape",
        outputBaseDir: tmpDir,
      }),
      /outside the allowed base directory/,
    );
  });

  it("saves an unknown mime type as .mp4 rather than guessing", async () => {
    const outcome = await generateVideoToDisk({
      registry: fakeRegistry({ mimeType: "video/x-unknown" }),
      prompt: "a cat",
      model: "fake-video",
      outputDir: tmpDir,
    });
    assert.equal(path.extname(outcome.savedFile), ".mp4");
  });
});
