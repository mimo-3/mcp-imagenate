import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createRegistry, keysFromEnv } from "../src/providers/registry.js";

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

  it("createReveProvider returns expected model names", async () => {
    const { createReveProvider } = await import("../src/providers/reve.js");
    const provider = createReveProvider("test-key");
    assert.deepEqual(Object.keys(provider.models), ["reve-image"]);
    assert.equal(typeof provider.generate, "function");
  });
});

describe("createRegistry", () => {
  it("registers only the providers whose key is supplied", () => {
    const registry = createRegistry({ openai: "k" });
    assert.deepEqual(registry.models, ["gpt-image-2"]);
  });

  it("returns an empty registry instead of exiting when no keys are given", () => {
    const registry = createRegistry({});
    assert.deepEqual(registry.models, []);
    assert.equal(registry.defaultModel, undefined);
  });

  it("explains the missing-key case when resolving against an empty registry", () => {
    const registry = createRegistry({});
    assert.throws(
      () => registry.resolve("gpt-image-2"),
      /no provider API key is configured/,
    );
  });

  it("lists the available models when resolving an unknown name", () => {
    const registry = createRegistry({ openai: "k" });
    assert.throws(
      () => registry.resolve("nano-banana-2"),
      /Available: gpt-image-2/,
    );
  });

  it("resolves a friendly name to its provider model id", () => {
    const registry = createRegistry({ google: "k" });
    assert.equal(
      registry.resolve("nano-banana-pro").modelId,
      "gemini-3-pro-image-preview",
    );
  });

  it("keeps registries independent of one another", () => {
    const openaiOnly = createRegistry({ openai: "k" });
    createRegistry({ google: "k", flux: "k" });
    assert.deepEqual(openaiOnly.models, ["gpt-image-2"]);
  });

  it("prefers gpt-image-2 as the default when several providers are configured", () => {
    const registry = createRegistry({ google: "k", openai: "k", flux: "k", reve: "k" });
    assert.equal(registry.defaultModel, "gpt-image-2");
  });

  it("registers Reve when only its key is supplied", () => {
    const registry = createRegistry({ reve: "k" });
    assert.deepEqual(registry.models, ["reve-image"]);
    assert.equal(registry.defaultModel, "reve-image");
  });

  it("carries a provider's input-image limit through to the resolved model", () => {
    // generateImageToDisk reads this before touching the filesystem, so it has
    // to survive registration rather than living only on the provider.
    assert.equal(createRegistry({ reve: "k" }).resolve("reve-image").maxInputImages, 8);
    assert.equal(createRegistry({ openai: "k" }).resolve("gpt-image-2").maxInputImages, undefined);
  });

  it("keeps a Google-only setup defaulting to the cheaper nano-banana-2", () => {
    // Changing this would silently move existing users onto a slower, pricier
    // model whenever they omit `model`.
    const registry = createRegistry({ google: "k", flux: "k" });
    assert.equal(registry.defaultModel, "nano-banana-2");
  });

  it("falls back to registration order outside the preference list", () => {
    const registry = createRegistry({ flux: "k" });
    assert.equal(registry.defaultModel, "flux-2-klein");
  });
});

describe("keysFromEnv", () => {
  it("reads the documented variables", () => {
    const keys = keysFromEnv({
      NANO_BANANA_API_KEY: "g",
      OPENAI_API_KEY: "o",
      BFL_API_KEY: "f",
      REVE_API_KEY: "r",
    } as NodeJS.ProcessEnv);
    assert.deepEqual(keys, { google: "g", openai: "o", flux: "f", reve: "r" });
  });

  it("prefers the provider-specific alias over the generic one", () => {
    const keys = keysFromEnv({
      NANO_BANANA_API_KEY: "specific",
      GEMINI_API_KEY: "generic",
      GPT_IMAGE_API_KEY: "specific",
      OPENAI_API_KEY: "generic",
    } as NodeJS.ProcessEnv);
    assert.equal(keys.google, "specific");
    assert.equal(keys.openai, "specific");
  });

  it("accepts REVE_API_TOKEN as an alias for REVE_API_KEY", () => {
    assert.equal(
      keysFromEnv({ REVE_API_TOKEN: "t" } as NodeJS.ProcessEnv).reve,
      "t",
    );
    assert.equal(
      keysFromEnv({
        REVE_API_KEY: "k",
        REVE_API_TOKEN: "t",
      } as NodeJS.ProcessEnv).reve,
      "k",
    );
  });

  it("treats an empty preferred variable as unset and uses the fallback", () => {
    // Env templates routinely define the preferred name as "", which must not
    // shadow an alias that actually holds a key.
    const keys = keysFromEnv({
      NANO_BANANA_API_KEY: "",
      GEMINI_API_KEY: "g",
      GPT_IMAGE_API_KEY: "",
      OPENAI_API_KEY: "o",
      REVE_API_KEY: "",
      REVE_API_TOKEN: "r",
    } as NodeJS.ProcessEnv);
    assert.deepEqual(keys, { google: "g", openai: "o", reve: "r" });
  });

  it("still falls back to the generic variable when only that is set", () => {
    const keys = keysFromEnv({
      GEMINI_API_KEY: "g",
      OPENAI_API_KEY: "o",
    } as NodeJS.ProcessEnv);
    assert.deepEqual(keys, { google: "g", openai: "o" });
  });

  it("omits providers with no key rather than setting undefined", () => {
    const keys = keysFromEnv({} as NodeJS.ProcessEnv);
    assert.deepEqual(keys, {});
  });
});
