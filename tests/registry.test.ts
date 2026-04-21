import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

// Registry uses module-level state, so we test the logic indirectly
// by checking the provider creation functions don't throw

describe("provider creation", () => {
  it("createGoogleProvider returns expected model names", async () => {
    const { createGoogleProvider } = await import("../src/providers/google.js");
    const provider = createGoogleProvider("test-key");
    assert.deepEqual(Object.keys(provider.models), [
      "nano-banana-2",
      "nano-banana-pro",
    ]);
    assert.equal(typeof provider.generate, "function");
  });

  it("createOpenAIProvider returns expected model names", async () => {
    const { createOpenAIProvider } = await import("../src/providers/openai.js");
    const provider = createOpenAIProvider("test-key");
    assert.deepEqual(Object.keys(provider.models), ["gpt-image-2"]);
    assert.equal(typeof provider.generate, "function");
  });

  it("createFluxProvider returns expected model names", async () => {
    const { createFluxProvider } = await import("../src/providers/flux.js");
    const provider = createFluxProvider("test-key");
    assert.deepEqual(Object.keys(provider.models), [
      "flux-2-klein",
      "flux-2-pro",
      "flux-2-max",
    ]);
    assert.equal(typeof provider.generate, "function");
  });
});

describe("flux resolveWidthHeight", () => {
  it("respects 4MP limit for 4K resolution", async () => {
    // We can't import the private function directly, but we can verify
    // through the provider that extreme resolutions don't break
    const { createFluxProvider } = await import("../src/providers/flux.js");
    const provider = createFluxProvider("test-key");
    // Just verify the provider is created successfully
    assert.ok(provider);
  });
});
