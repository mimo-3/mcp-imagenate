# mcp-imagenate

An MCP server for image generation using multiple providers: **Google Gemini**, **OpenAI (gpt-image)**, and **BFL FLUX**.

## Providers & Models

### Google Gemini (Nano Banana)

| Name              | Model ID                         | Best for                     |
| ----------------- | -------------------------------- | ---------------------------- |
| `nano-banana-2`   | `gemini-3.1-flash-image-preview` | Fast, high-volume generation |
| `nano-banana-pro` | `gemini-3-pro-image-preview`     | Highest quality output       |

### OpenAI

| Name              | Model ID          | Best for                       |
| ----------------- | ----------------- | ------------------------------ |
| `gpt-image-1.5`   | `gpt-image-1.5`  | High quality, prompt adherence |

### BFL FLUX

| Name            | Model ID      | Best for                         |
| --------------- | ------------- | -------------------------------- |
| `flux-2-klein`  | `klein-4b`    | Fast, lightweight generation     |
| `flux-2-pro`    | `pro-preview` | Balanced quality and speed       |
| `flux-2-max`    | `max`         | Maximum quality                  |

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
| `NANO_BANANA_OUTPUT_DIR`  | No       | Base directory for saved images. When set, all output and input paths are sandboxed within this directory. **Recommended for production.** |

\* At least one provider API key must be set.

## Tool: `generate_image`

### Parameters

| Parameter      | Type                                                   | Default           | Description                                                                   |
| -------------- | ------------------------------------------------------ | ----------------- | ----------------------------------------------------------------------------- |
| `prompt`       | `string` (1-10,000 chars)                              | -                 | Text prompt describing the image                                              |
| `model`        | see Models above                                       | `"nano-banana-2"` | Model to use (available models depend on configured API keys)                 |
| `resolution`   | `"1K"` \| `"2K"` \| `"4K"`                            | `"1K"`            | Output image resolution                                                       |
| `aspectRatio`  | see below                                              | `"1:1"`           | Aspect ratio of the image                                                     |
| `mode`         | `"image"` \| `"image_and_text"`                        | `"image"`         | Return image only, or image with description (Google models only)             |
| `thinking`     | `"none"` \| `"auto"`                                   | `"auto"`          | Controls model thinking (Google models only)                                  |
| `outputDir`    | `string`                                               | `"."`             | Directory where images will be saved                                          |
| `inputImages`  | `string[]`                                             | -                 | File paths of images to send alongside the prompt (Google models only)        |

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

## Security

- **Path sandboxing**: When `NANO_BANANA_OUTPUT_DIR` is set, both output and input image paths are sandboxed within this directory. Symlinks that resolve outside the sandbox are rejected.
- **Input validation**: Input images are validated for format (PNG/JPEG/WEBP/GIF) and size (max 20 MB).
- **API key validation**: The server exits immediately if no API keys are configured.

## License

MIT
