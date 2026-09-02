import type {
  VideoGenerateParams,
  VideoGenerateResult,
  VideoProviderRegistration,
} from "./video-types.js";

/**
 * Gemini Omni only answers on the Interactions API — `generateContent` rejects
 * it outright — and @google/genai types that endpoint's `response_format` as
 * `unknown`, so the request is built by hand against the REST shape documented
 * at https://ai.google.dev/api/interactions-api. Going through fetch also
 * keeps the provider testable without a network.
 */

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

/** Per the model card: clips run 3–10 s at a fixed 24 fps. */
export const OMNI_MIN_DURATION_SECONDS = 3;
export const OMNI_MAX_DURATION_SECONDS = 10;

/**
 * Above this size Google recommends `delivery: "uri"`; inline base64 still
 * worked at ~10 MB in practice, but the file endpoint is the documented path
 * and avoids a JSON body that grows with the clip.
 */
const INLINE_DELIVERY_MAX_SECONDS = 5;

export interface OmniVideoProviderOptions {
  /** Injected for tests; defaults to the global fetch. */
  fetch?: typeof fetch;
  baseUrl?: string;
}

type InputPart =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mime_type: string };

interface InteractionContent {
  type?: string;
  text?: string;
  data?: string;
  uri?: string;
  mime_type?: string;
}

interface InteractionResponse {
  id?: string;
  status?: string;
  steps?: Array<{ type?: string; content?: InteractionContent[] }>;
  error?: { message?: string; code?: string };
}

function buildInput(params: VideoGenerateParams): string | InputPart[] {
  if (!params.inputImages || params.inputImages.length === 0) {
    return params.prompt;
  }
  if (
    !params.inputImageMimeTypes ||
    params.inputImageMimeTypes.length !== params.inputImages.length
  ) {
    throw new Error("inputImageMimeTypes must be provided and match inputImages length");
  }
  const parts: InputPart[] = params.inputImages.map((image, i) => ({
    type: "image",
    data: image.toString("base64"),
    mime_type: params.inputImageMimeTypes![i],
  }));
  parts.push({ type: "text", text: params.prompt });
  return parts;
}

async function readErrorMessage(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text) as InteractionResponse;
    if (parsed.error?.message) return parsed.error.message;
  } catch {
    // Not JSON; fall through to the raw body.
  }
  return text || response.statusText;
}

export function createOmniVideoProvider(
  apiKey: string,
  options: OmniVideoProviderOptions = {},
): VideoProviderRegistration {
  const fetchImpl = options.fetch ?? fetch;
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  const headers = {
    "x-goog-api-key": apiKey,
    "Content-Type": "application/json",
  };

  const generate = async (params: VideoGenerateParams): Promise<VideoGenerateResult> => {
    const delivery = params.durationSeconds > INLINE_DELIVERY_MAX_SECONDS ? "uri" : "inline";

    const body: Record<string, unknown> = {
      model: params.modelId,
      input: buildInput(params),
      response_format: {
        type: "video",
        duration: `${params.durationSeconds}s`,
        resolution: params.resolution,
        aspect_ratio: params.aspectRatio,
        delivery,
      },
    };
    if (params.previousInteractionId) {
      body.previous_interaction_id = params.previousInteractionId;
    }

    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}/interactions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Gemini Omni request failed: ${message}`);
    }
    if (!response.ok) {
      throw new Error(
        `Gemini Omni request failed (${response.status}): ${await readErrorMessage(response)}`,
      );
    }

    const interaction = (await response.json()) as InteractionResponse;
    if (interaction.error?.message) {
      throw new Error(`Gemini Omni request failed: ${interaction.error.message}`);
    }

    let video: InteractionContent | undefined;
    let description: string | undefined;
    for (const step of interaction.steps ?? []) {
      if (step.type !== "model_output") continue;
      for (const content of step.content ?? []) {
        if (content.type === "video" && !video) {
          video = content;
        } else if (content.type === "text" && content.text?.trim()) {
          description = (description ?? "") + content.text;
        }
      }
    }

    if (!video) {
      throw new Error(
        `No video was returned by the model (status: ${interaction.status ?? "unknown"})`,
      );
    }

    let bytes: Buffer;
    if (video.data) {
      bytes = Buffer.from(video.data, "base64");
    } else if (video.uri) {
      // The file endpoint wants the same key header; a bare GET is refused.
      const download = await fetchImpl(video.uri, {
        headers: { "x-goog-api-key": apiKey },
      });
      if (!download.ok) {
        throw new Error(
          `Gemini Omni video download failed (${download.status}): ${await readErrorMessage(download)}`,
        );
      }
      bytes = Buffer.from(await download.arrayBuffer());
    } else {
      throw new Error("Video content had neither inline data nor a download uri");
    }

    const result: VideoGenerateResult = {
      video: bytes,
      mimeType: video.mime_type ?? "video/mp4",
    };
    if (description?.trim()) result.description = description.trim();
    if (interaction.id) result.interactionId = interaction.id;
    return result;
  };

  return {
    models: {
      "omni-flash": "gemini-omni-1.1-flash",
    },
    generate,
    minDurationSeconds: OMNI_MIN_DURATION_SECONDS,
    maxDurationSeconds: OMNI_MAX_DURATION_SECONDS,
  };
}
