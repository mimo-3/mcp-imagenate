/**
 * Public library surface for mcp-imagenate.
 *
 * Import this (`import { createRegistry } from "mcp-imagenate"`) to embed image
 * generation in another host — an app, or another MCP server that wants to
 * expose its own tool. Nothing here reads `process.env`, writes to stdio, or
 * exits the process; the standalone MCP server lives at `mcp-imagenate/server`.
 */

export {
  createRegistry,
  keysFromEnv,
  type ImageRegistry,
  type ProviderKeys,
  type ResolvedModel,
} from "./providers/registry.js";

export {
  generateImageToDisk,
  ASPECT_RATIOS,
  BACKGROUNDS,
  RESOLUTIONS,
  type AspectRatio,
  type GenerateImageOptions,
  type GenerateImageOutcome,
  type GenerationMode,
  type Resolution,
  type Thinking,
} from "./generate.js";

export type {
  Background,
  GenerateParams,
  GenerateResult,
  ProviderFn,
  ProviderRegistration,
} from "./providers/types.js";

export {
  getDefaultOutputBaseDir,
  isInsideBase,
  resolveInputImagePath,
  resolveOutputDir,
  MAX_INPUT_IMAGE_SIZE,
} from "./sandbox.js";

export {
  createVideoRegistry,
  type ResolvedVideoModel,
  type VideoRegistry,
} from "./providers/video-registry.js";

export {
  generateVideoToDisk,
  VIDEO_ASPECT_RATIOS,
  VIDEO_RESOLUTIONS,
  type GenerateVideoOptions,
  type GenerateVideoOutcome,
} from "./generate-video.js";

export type {
  VideoAspectRatio,
  VideoGenerateParams,
  VideoGenerateResult,
  VideoProviderFn,
  VideoProviderRegistration,
  VideoResolution,
} from "./providers/video-types.js";
