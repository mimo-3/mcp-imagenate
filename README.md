# mcp-imagenate

<p align="center">
  <img src="https://raw.githubusercontent.com/mimo-3/mcp-imagenate/main/imagenerate-cat.png" alt="mcp-imagenate" width="400">
</p>

An MCP server for image generation using multiple providers: **Google Gemini**, **OpenAI (gpt-image)**, **BFL FLUX**, and **Reve**.

## Providers & Models

### Google Gemini (Nano Banana)

| Name              | Model ID                         | Best for                     |
| ----------------- | -------------------------------- | ---------------------------- |
| `nano-banana-2`   | `gemini-3.1-flash-image-preview` | Fast, high-volume generation |
| `nano-banana-pro` | `gemini-3-pro-image-preview`     | Highest quality output       |

### OpenAI

| Name          | Model ID      | Best for                           |
| ------------- | ------------- | ---------------------------------- |
| `gpt-image-2` | `gpt-image-2` | Latest generation, improved detail |

### BFL FLUX

| Name            | Model ID      | Best for                         |
| --------------- | ------------- | -------------------------------- |
| `flux-2-klein`  | `klein-4b`    | Fast, lightweight generation     |
| `flux-2-pro`    | `pro-preview` | Balanced quality and speed       |
| `flux-2-max`    | `max`         | Maximum quality                  |

### Reve

| Name         | Version  | Best for                       |
| ------------ | -------- | ------------------------------ |
| `reve-image` | `latest` | Typography and layout fidelity |

This provider calls Reve's `v2/image/create` endpoint. `latest` is the only version
alias v2 exposes, and it is what the response reports back, so there is no dated
build to pin to. Do not confuse it with the `v1` endpoints, which still serve the
older `reve-create@20250915` model.

Things worth knowing before sending Reve a prompt written for another provider:

- `resolution` is ignored — Reve has no size parameter and returns its own large
  output. Exact dimensions vary between requests: `16:9` came back as both
  5408x3072 and 5376x3072, and `3:4` as 3456x4800.
- Prompts are capped at 4,000 characters, and this provider rejects longer ones
  before spending a request.
- `inputImages` become v2 `references`. Reve accepts at most eight; a longer list
  is rejected before any of the files are read.
- The saved file's extension follows the format Reve actually returned (PNG, JPEG
  or WebP), which is detected from the bytes rather than assumed.
- A generation costs 150 credits (about $0.20) and typically takes 40-80 seconds.
  Give any proxy or job runner in front of it a timeout of at least 120 seconds.

## Requirements

- Node.js 20+
- At least one provider API key

## Installation

```bash
npx mcp-imagenate
```

Or install globally:

```bash
npm install -g mcp-imagenate
```

## Setup

Set API keys for the providers you want to use:

```bash
# Google Gemini (at least one)
export GEMINI_API_KEY=your_key_here
# or
export NANO_BANANA_API_KEY=your_key_here

# OpenAI (at least one)
export OPENAI_API_KEY=your_key_here
# or
export GPT_IMAGE_API_KEY=your_key_here

# BFL FLUX
export BFL_API_KEY=your_key_here

# Reve (at least one)
export REVE_API_KEY=your_key_here
# or
export REVE_API_TOKEN=your_key_here
```

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "mcp-imagenate": {
      "command": "npx",
      "args": ["mcp-imagenate"],
      "env": {
        "GEMINI_API_KEY": "your_key_here",
        "NANO_BANANA_OUTPUT_DIR": "/path/to/image/output"
      }
    }
  }
}
```

## Environment Variables

| Variable                  | Required | Description                                                                                                   |
| ------------------------- | -------- | ------------------------------------------------------------------------------------------------------------- |
| `GEMINI_API_KEY`          | \*       | Google AI Studio API key                                                                                      |
| `NANO_BANANA_API_KEY`     | \*       | Alternative to `GEMINI_API_KEY` (takes precedence)                                                            |
| `OPENAI_API_KEY`          | \*       | OpenAI API key                                                                                                |
| `GPT_IMAGE_API_KEY`       | \*       | Alternative to `OPENAI_API_KEY` (takes precedence)                                                            |
| `BFL_API_KEY`             | \*       | BFL FLUX API key                                                                                              |
| `REVE_API_KEY`            | \*       | Reve partner API token (from the API console at api.reve.com)                                                 |
| `REVE_API_TOKEN`          | \*       | Alternative to `REVE_API_KEY` (`REVE_API_KEY` takes precedence)                                               |
| `NANO_BANANA_OUTPUT_DIR`  | No       | Base directory for saved images. When set, all output and input paths are sandboxed within this directory. **Recommended for production.** |

\* At least one provider API key must be set.

## Tool: `generate_image`

### Parameters

| Parameter      | Type                                                   | Default           | Description                                                                   |
| -------------- | ------------------------------------------------------ | ----------------- | ----------------------------------------------------------------------------- |
| `prompt`       | `string` (1-32,000 chars)                              | -                 | Text prompt describing the image                                              |
| `model`        | see Models above                                       | `"gpt-image-2"`   | Model to use (available models depend on configured API keys)                 |
| `resolution`   | `"1K"` \| `"2K"` \| `"4K"`                            | `"1K"`            | Output image resolution                                                       |
| `aspectRatio`  | see below                                              | `"1:1"`           | Aspect ratio of the image                                                     |
| `mode`         | `"image"` \| `"image_and_text"`                        | `"image"`         | Return image only, or image with description (Google models only)             |
| `thinking`     | `"none"` \| `"auto"`                                   | `"auto"`          | Controls model thinking (Google models only)                                  |
| `outputDir`    | `string`                                               | `"."`             | Directory where images will be saved                                          |
| `inputImages`  | `string[]`                                             | -                 | File paths of images to send alongside the prompt (Google models, OpenAI gpt-image models via the images.edit endpoint, and Reve via v2 `references`) |

#### Supported aspect ratios

`1:1`, `2:3`, `3:2`, `3:4`, `4:3`, `9:16`, `16:9`, `21:9`

### Response

Returns a JSON object:

```json
{
  "model": "gemini-3.1-flash-image-preview",
  "savedFiles": ["/path/to/image-1.png"],
  "settings": {
    "resolution": "1K",
    "aspectRatio": "9:16",
    "mode": "image"
  },
  "description": "..."
}
```

> `description` is only present when `mode` is `"image_and_text"`.

## Use as a library

Besides the standalone MCP server, this package can be embedded in another host —
an app, or another MCP server that wants to expose image generation as its own tool.

```ts
import { createRegistry, generateImageToDisk } from "mcp-imagenate";

// Keys are passed in explicitly; nothing here reads process.env.
const registry = createRegistry({ openai: myOpenAIKey, google: myGoogleKey });

if (registry.models.length === 0) {
  throw new Error("No image provider is configured");
}

const outcome = await generateImageToDisk({
  registry,
  prompt: "a calico cat asleep on a warm keyboard",
  model: registry.defaultModel!,
  aspectRatio: "16:9",
  outputDir: "/somewhere/to/write",
  // outputBaseDir defaults to null, meaning no path sandboxing. Set it to a
  // directory to confine both output and input paths within that directory.
});

console.log(outcome.savedFiles);
```

The library entry point never reads `process.env`, writes to stdio, or exits the
process. To read keys from the conventional environment variables anyway, use the
`keysFromEnv()` helper. The standalone server is available at `mcp-imagenate/server`.

| Export | Purpose |
| --- | --- |
| `createRegistry(keys)` | Build a registry of the models available for the given keys |
| `keysFromEnv(env?)` | Read provider keys from environment variables |
| `generateImageToDisk(options)` | Generate images and write them to disk |
| `resolveOutputDir` / `resolveInputImagePath` | Path sandboxing helpers (opt-in) |

## Security

- **Path sandboxing**: When `NANO_BANANA_OUTPUT_DIR` is set, both output and input image paths are sandboxed within this directory. Symlinks that resolve outside the sandbox are rejected. For library embedders this is opt-in via `outputBaseDir`, since the host usually controls which paths reach the call.
- **Input validation**: Input images are validated for format (PNG/JPEG/WEBP/GIF) and size (max 20 MB).
- **API key validation**: The server exits immediately if no API keys are configured. The library reports this as an empty registry instead, leaving the decision to the host.

## License

MIT
