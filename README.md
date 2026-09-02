# mcp-imagenate

<p align="center">
  <img src="https://raw.githubusercontent.com/mimo-3/mcp-imagenate/main/imagenerate-cat.png" alt="mcp-imagenate" width="400">
</p>

An MCP server for image generation using multiple providers: **Google Gemini**, **OpenAI (gpt-image)**, **BFL FLUX**, and **Reve** — plus short video clips through **Google Gemini Omni**.

## Providers & Models

### Google Gemini (Nano Banana)

| Name              | Model ID                         | Best for                     |
| ----------------- | -------------------------------- | ---------------------------- |
| `nano-banana-2`   | `gemini-3.1-flash-image-preview` | Fast, high-volume generation |
| `nano-banana-pro` | `gemini-3-pro-image-preview`     | Highest quality output       |

### Google Gemini Omni (video)

| Name         | Model ID               | Best for                                   |
| ------------ | ---------------------- | ------------------------------------------ |
| `omni-flash` | `gemini-omni-1.1-flash` | 3–10 s clips with audio, legible on-screen text |

Uses the same `GEMINI_API_KEY`. Exposed through a separate `generate_video` tool —
see [Tool: `generate_video`](#tool-generate_video).

### OpenAI

| Name          | Model ID      | Best for                           |
| ------------- | ------------- | ---------------------------------- |
| `gpt-image-2` | `gpt-image-2` | Latest generation, improved detail |

These are the only models here that can return a transparent background — see
[Transparent backgrounds](#transparent-backgrounds).

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

- Node.js 18+
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
| `background`   | `"auto"` \| `"transparent"` \| `"opaque"`              | `"auto"`          | What the image sits on. `"transparent"` needs a gpt-image model — see below   |
| `thinking`     | `"none"` \| `"auto"`                                   | `"auto"`          | Controls model thinking (Google models only)                                  |
| `outputDir`    | `string`                                               | `"."`             | Directory where images will be saved                                          |
| `inputImages`  | `string[]`                                             | -                 | File paths of images to send alongside the prompt (Google models, OpenAI gpt-image models via the images.edit endpoint, and Reve via v2 `references`) |

#### Supported aspect ratios

`1:1`, `2:3`, `3:2`, `3:4`, `4:3`, `9:16`, `16:9`, `21:9`

#### Transparent backgrounds

`background: "transparent"` saves a PNG with an alpha channel, which is useful for
cutting out a subject to place on a slide or over another image.

Only the OpenAI gpt-image models can do this. Asking any other model
(`nano-banana-*`, `flux-2-*`, `reve-image`) for a transparent background **fails
with an error** rather than quietly returning an opaque image — the request is
rejected before it is sent, so nothing is spent on it. Writing "transparent
background" into the prompt does not help either: those providers have no
transparency mode at all.

`"opaque"` forces a filled background on every provider that reads the field, and
`"auto"` — the default — leaves the choice to the model, which is what this server
has always done.

### Response

Returns a JSON object:

```json
{
  "model": "gemini-3.1-flash-image-preview",
  "savedFiles": ["/path/to/image-1.png"],
  "settings": {
    "resolution": "1K",
    "aspectRatio": "9:16",
    "mode": "image",
    "background": "auto"
  },
  "description": "..."
}
```

> `description` is only present when `mode` is `"image_and_text"`.

## Tool: `generate_video`

Available when a Google key is configured. Generates one clip with audio and
saves it as an mp4.

### Parameters

| Parameter               | Type                                          | Default        | Description                                                                                       |
| ----------------------- | --------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------- |
| `prompt`                | `string` (1-32,000 chars)                     | -              | Subject, motion, camera, and any on-screen text spelled out exactly                               |
| `model`                 | `"omni-flash"`                                | `"omni-flash"` | Video model to use                                                                                |
| `durationSeconds`       | integer `3`–`10`                              | `5`            | Clip length. Cost scales with the second, and so does generation time (roughly 1 min for 5 s, 2 min for 10 s) |
| `resolution`            | `"360p"` \| `"720p"` \| `"1080p"` \| `"4k"` | `"720p"`       | Playback resolution. `360p` is the cheapest and fastest; `1080p` and `4k` are upscaled from 720p |
| `aspectRatio`           | `"16:9"` \| `"9:16"`                          | `"16:9"`       | Landscape or portrait                                                                             |
| `outputDir`             | `string`                                      | `"."`          | Directory where the clip will be saved (same sandboxing as `generate_image`)                     |
| `inputImages`           | `string[]`                                    | -              | Reference images sent ahead of the prompt: a first frame to animate, or subjects and styles to keep. Refer to them as `<IMAGE_REF_1>`, `<IMAGE_REF_2>`, … |
| `previousInteractionId` | `string`                                      | -              | `interactionId` from an earlier result. Extends that clip instead of starting a new one; the prompt describes what happens next |

Things worth knowing:

- A single request is capped at 10 s by the model. To go longer, pass the
  returned `interactionId` back as `previousInteractionId`; each extension adds
  up to 10 s, and the whole clip is returned each time.
- Text in the prompt is rendered on screen as written, including non-Latin
  scripts, though Google only documents English as fully supported.
- Clips longer than 5 s are fetched through Google's file endpoint rather than
  inlined in the JSON response, as the API documentation recommends above 4 MB.
- 720p costs about $0.10 per second of output; there is no free tier for this model.

### Response

```json
{
  "model": "gemini-omni-1.1-flash",
  "savedFile": "/path/to/1788347054697-491db547.mp4",
  "settings": {
    "durationSeconds": 5,
    "resolution": "720p",
    "aspectRatio": "16:9"
  },
  "interactionId": "v1_...",
  "description": "..."
}
```

> `description` is only present when the model returns text alongside the clip.

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

`generateImageToDisk` takes the same options as the tool, so `background:
"transparent"` throws for a model that cannot deliver an alpha channel. Check
`registry.resolve(model).supportsTransparentBackground` first if the model is not
one you chose yourself.

The library entry point never reads `process.env`, writes to stdio, or exits the
process. To read keys from the conventional environment variables anyway, use the
`keysFromEnv()` helper. The standalone server is available at `mcp-imagenate/server`.

| Export | Purpose |
| --- | --- |
| `createRegistry(keys)` | Build a registry of the models available for the given keys |
| `keysFromEnv(env?)` | Read provider keys from environment variables |
| `generateImageToDisk(options)` | Generate images and write them to disk |
| `createVideoRegistry(keys)` | Build a registry of the video models available for the given keys |
| `generateVideoToDisk(options)` | Generate a clip and write it to disk |
| `resolveOutputDir` / `resolveInputImagePath` | Path sandboxing helpers (opt-in) |

## Security

- **Path sandboxing**: When `NANO_BANANA_OUTPUT_DIR` is set, both output and input image paths are sandboxed within this directory. Symlinks that resolve outside the sandbox are rejected. For library embedders this is opt-in via `outputBaseDir`, since the host usually controls which paths reach the call.
- **Input validation**: Input images are validated for format (PNG/JPEG/WEBP/GIF) and size (max 20 MB). Video durations outside the model's range are rejected before any request is sent.
- **API key validation**: The server exits immediately if no API keys are configured. The library reports this as an empty registry instead, leaving the decision to the host.

## License

MIT
