import { it } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

it("publishes Zod tool schemas and validates inputs through MCP", { timeout: 10_000 }, async () => {
  const client = new Client({ name: "deps-compat-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL("../src/index.js", import.meta.url))],
    // Fake keys enable both tools without inheriting real credentials.
    env: { GEMINI_API_KEY: "deps-test-key", OPENAI_API_KEY: "deps-test-key" },
    stderr: "pipe",
  });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((tool) => tool.name).sort(), ["generate_image", "generate_video"]);
    for (const tool of tools) {
      assert.equal(tool.inputSchema.type, "object");
      assert.deepEqual(tool.inputSchema.required, ["prompt"]);
      const properties = tool.inputSchema.properties as Record<string, Record<string, unknown>>;
      assert.equal(properties.prompt.minLength, 1);
      assert.equal(properties.prompt.maxLength, 32_000);
      assert.equal(properties.outputDir.default, ".");
      assert.equal(properties.inputImages.type, "array");
      assert.ok(Array.isArray(properties.model.enum));
      assert.ok(properties.model.enum.includes(properties.model.default));
      assert.equal(properties.resolution.default, tool.name === "generate_image" ? "1K" : "720p");

      if (tool.name === "generate_video") {
        assert.equal(properties.durationSeconds.maximum, 15);
        assert.equal(properties.model.default, "gemini-omni-1.2-flash");
        assert.match(String(properties.durationSeconds.description), /gemini-omni-1\.1-flash: 10s/);
        assert.match(String(properties.durationSeconds.description), /gemini-omni-1\.2-flash: 15s/);
        const result = await client.callTool({
          name: tool.name,
          arguments: { prompt: "test", model: "gemini-omni-1.1-flash", durationSeconds: 12 },
        });
        assert.equal(result.isError, true);
        assert.match(JSON.stringify(result.content), /3–10 whole seconds/);
      }

      // These requests must fail before any provider can make a network call.
      for (const args of [{ prompt: "" }, { prompt: "test", model: "deps-unknown-model" }]) {
        const result = await client.callTool({ name: tool.name, arguments: args });
        assert.equal(result.isError, true);
        assert.match(JSON.stringify(result.content), /validation|invalid/i);
      }
    }
  } finally {
    await client.close();
  }
});
