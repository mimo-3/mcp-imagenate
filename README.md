# nano-banana-mcp

An MCP server for image generation using **Nano Banana** (Google Gemini) models via Google AI Studio.

## Models

| Name | Model ID | Best for |
|---|---|---|
| `nano-banana-2` | `gemini-3.1-flash-image-preview` | Fast, high-volume generation |
| `nano-banana-pro` | `gemini-3-pro-image-preview` | Highest quality output |

## Requirements

- Node.js 18+
- A [Google AI Studio](https://aistudio.google.com/) API key

## Installation

```bash
npx nano-banana-mcp
```

Or install globally:

```bash
npm install -g nano-banana-mcp
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
    "nano-banana-mcp": {
      "command": "npx",
      "args": ["nano-banana-mcp"],
      "env": {
        "GEMINI_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

## Tool: `generate_image`

### Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `prompt` | `string` | — | Text prompt describing the image |
| `model` | `"nano-banana-2"` \| `"nano-banana-pro"` | `"nano-banana-2"` | Model to use |
| `resolution` | `"1K"` \| `"2K"` \| `"4K"` | `"1K"` | Output image resolution |
| `aspectRatio` | see below | `"1:1"` | Aspect ratio of the image |
| `thinkingLevel` | `"none"` \| `"low"` \| `"medium"` \| `"high"` | `"medium"` | Reasoning depth before generation |
| `mode` | `"image"` \| `"image_and_text"` | `"image"` | Return image only, or image with description |
| `numberOfImages` | `1`–`4` | `1` | Number of images to generate |
| `outputDir` | `string` | — | Directory where images will be saved |

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
    "thinkingLevel": "medium",
    "mode": "image",
    "numberOfImages": 1
  },
  "description": "..." // only present when mode is "image_and_text"
}
```

## License

MIT
