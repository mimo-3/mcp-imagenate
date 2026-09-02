import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createVideoRegistry } from "../src/providers/video-registry.js";

describe("createVideoRegistry", () => {
  it("is empty without a Google key", () => {
    const reg = createVideoRegistry({ openai: "x", flux: "y", reve: "z" });
    assert.deepEqual(reg.models, []);
    assert.equal(reg.defaultModel, undefined);
    assert.throws(() => reg.resolve("gemini-omni-1.1-flash"), /No video models are available/);
  });

  it("exposes gemini-omni-1.1-flash when a Google key is set", () => {
    const reg = createVideoRegistry({ google: "g" });
    assert.deepEqual(reg.models, ["gemini-omni-1.1-flash"]);
    assert.equal(reg.defaultModel, "gemini-omni-1.1-flash");
    const resolved = reg.resolve("gemini-omni-1.1-flash");
    assert.equal(resolved.modelId, "gemini-omni-1.1-flash");
    assert.equal(resolved.minDurationSeconds, 3);
    assert.equal(resolved.maxDurationSeconds, 10);
  });

  it("names the available models when asked for an unknown one", () => {
    const reg = createVideoRegistry({ google: "g" });
    assert.throws(() => reg.resolve("veo"), /Unknown video model: veo\. Available: gemini-omni-1.1-flash/);
  });
});
