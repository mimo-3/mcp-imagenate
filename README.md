# mcp-imagenate

An MCP server for image generation using **Nano Banana** (Google Gemini) models via Google AI Studio.

## Models

| Name              | Model ID                         | Best for                     |
| ----------------- | -------------------------------- | ---------------------------- |
| `nano-banana-2`   | `gemini-3.1-flash-image-preview` | Fast, high-volume generation |
| `nano-banana-pro` | `gemini-3-pro-image-preview`     | Highest quality output       |

## Requirements

- Node.js 18+
- A [Google AI Studio](https://aistudio.google.com/) API key

## Installation

```bash
npx mcp-imagenate
```

Or install globally:

```bash
npm install -g mcp-imagenate
```

## Setup

Set your API key as an environment variable:

```bash
export GEMINI_API_KEY=your_api_key_here
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
        "GEMINI_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

## Environment Variables

| Variable                  | Required | Description                                                                                                   |
| ------------------------- | -------- | ------------------------------------------------------------------------------------------------------------- |
| `GEMINI_API_KEY`          | Yes\*    | Google AI Studio API key                                                                                      |
| `NANO_BANANA_API_KEY`     | Yes\*    | Alternative to `GEMINI_API_KEY` (takes precedence)                                                            |
| `NANO_BANANA_OUTPUT_DIR`  | No       | Base directory for saved images. When set, all `outputDir` values are resolved relative to and sandboxed within this path. Recommended for production. |

\* At least one API key variable must be set.

## Tool: `generate_image`

### Parameters

| Parameter      | Type                                                   | Default           | Description                                                                   |
| -------------- | ------------------------------------------------------ | ----------------- | ----------------------------------------------------------------------------- |
| `prompt`       | `string` (1–10,000 chars)                              | —                 | Text prompt describing the image                                              |
| `model`        | `"nano-banana-2"` \| `"nano-banana-pro"`               | `"nano-banana-2"` | Model to use                                                                  |
| `resolution`   | `"1K"` \| `"2K"` \| `"4K"`                            | `"1K"`            | Output image resolution                                                       |
| `aspectRatio`  | see below                                              | `"1:1"`           | Aspect ratio of the image                                                     |
| `mode`         | `"image"` \| `"image_and_text"`                        | `"image"`         | Return image only, or image with description                                  |
| `thinking`     | `"none"` \| `"auto"`                                   | `"auto"`          | `none` disables thinking; `auto` lets the model decide its reasoning budget   |
| `outputDir`    | `string`                                               | `"."`             | Directory where images will be saved                                          |
| `inputImages`  | `string[]`                                             | —                 | File paths of images to send alongside the prompt (PNG/JPEG/WEBP/GIF)        |

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

- **Output sandboxing**: Set `NANO_BANANA_OUTPUT_DIR` to restrict where images can be written. Any `outputDir` value that would resolve outside this base directory is rejected.
- **API key**: Validated at startup; the server exits immediately if not set.

## License

MIT
