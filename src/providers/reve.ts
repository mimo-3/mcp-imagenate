import type { GenerateParams, GenerateResult, ProviderRegistration } from "./types.js";

const REVE_CREATE_URL = "https://api.reve.com/v2/image/create";

/** Documented hard limits on the v2 create endpoint. */
const MAX_PROMPT_LENGTH = 4000;
const MAX_REFERENCES = 8;

/**
 * Upper bound on how long a single request may run. Reve takes 40-80s for a
 * typical generation and asks for client timeouts of at least 120s, so this is
 * deliberately generous — it exists to stop a stalled socket hanging the host
 * forever, not to bound normal work.
 */
const REQUEST_TIMEOUT_MS = 300_000;

/** Cap on how much of an error body is quoted back to the caller. */
const MAX_ERROR_DETAIL = 200;

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * Formats Reve can return, matched on their leading bytes. Sniffing beats
 * trusting the request: the API documents PNG, JPEG and WebP results, and the
 * saved file's extension is derived from the MIME we report here.
 *
 * A format may need several anchors — WebP is a RIFF container, so both the
 * `RIFF` tag and the `WEBP` form type have to line up.
 *
 * This identifies the container, not a well-formed image: a truncated PNG still
 * matches. Validating the full structure is the image decoder's job, and this
 * only has to pick the right file extension.
 */
const IMAGE_SIGNATURES: { mimeType: string; parts: { offset: number; magic: Buffer }[] }[] = [
  {
    mimeType: "image/png",
    parts: [{ offset: 0, magic: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) }],
  },
  {
    mimeType: "image/jpeg",
    parts: [{ offset: 0, magic: Buffer.from([0xff, 0xd8, 0xff]) }],
  },
  {
    mimeType: "image/webp",
    parts: [
      { offset: 0, magic: Buffer.from("RIFF", "ascii") },
      { offset: 8, magic: Buffer.from("WEBP", "ascii") },
    ],
  },
];

/**
 * Largest response body accepted, comfortably above a 16 MP PNG (the biggest
 * thing Reve produces) while still bounding what a single reply can pin in
 * memory as text, parsed JSON and a decoded buffer at once.
 */
export const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;

/**
 * Read a response body as text, giving up once `limit` bytes have arrived.
 *
 * `response.text()` would buffer whatever the server sends, so the cap has to
 * be applied while reading rather than afterwards: `Content-Length` is only a
 * claim, and it is absent entirely on a chunked response. The declared length
 * is still honoured first, as it lets an oversized reply be refused without
 * transferring it.
 *
 * Exported for tests, which exercise the boundaries with a small limit rather
 * than allocating the real one.
 */
export async function readBoundedText(
  response: Response,
  limit: number,
): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) {
    // Undici expects a body to be consumed or discarded; leaving it dangling
    // holds the connection open.
    await response.body?.cancel();
    throw new Error(
      `Reve returned a ${declared} byte response, over this client's ${limit} byte limit`,
    );
  }

  if (!response.body) return response.text();

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new Error(
        `Reve response exceeded this client's ${limit} byte limit`,
      );
    }
    text += decoder.decode(value, { stream: true });
  }

  return text + decoder.decode();
}

/**
 * Trim an error body to one bounded, single-line string. Reve's messages end up
 * in MCP client transcripts and logs, so newlines and control characters are
 * flattened rather than passed through.
 */
function sanitizeDetail(detail: string): string {
  const flattened = detail.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  return flattened.length > MAX_ERROR_DETAIL
    ? `${flattened.slice(0, MAX_ERROR_DETAIL)}...`
    : flattened;
}

/**
 * Count code points, stopping at `limit`. Reve documents its cap in characters,
 * and counting UTF-16 units would reject prompts that fit purely because they
 * contain emoji. Spreading the string into an array would allocate a slot per
 * character first, so an over-long prompt is walked only until it is known to
 * be over.
 */
function countCodePoints(text: string, limit: number): number {
  let count = 0;
  for (const _ of text) {
    if (++count >= limit) break;
  }
  return count;
}

/**
 * Decode the `image` field into a buffer and the format it actually holds.
 *
 * Node's base64 decoder is lenient: it skips characters it does not recognise
 * and drops a trailing partial group. A response that is corrupt in either way
 * would otherwise decode to a short but plausible-looking file and be written
 * to disk, so the encoding is checked strictly before decoding.
 */
function decodeImage(image: unknown): { buffer: Buffer; mimeType: string } {
  if (typeof image !== "string" || image === "") {
    throw new Error("Reve returned no usable image data");
  }

  let payload = image;
  if (payload.startsWith("data:")) {
    const match = /^data:image\/[a-z0-9.+-]+;base64,/i.exec(payload);
    if (!match) {
      throw new Error("Reve returned an image in an unsupported encoding");
    }
    payload = payload.slice(match[0].length);
  }

  if (payload.length > MAX_RESPONSE_BYTES) {
    throw new Error("Reve returned an image larger than this client accepts");
  }

  // The length check is what stops a truncated payload: without it Node
  // discards the incomplete final group and returns a shorter image.
  if (payload.length % 4 !== 0 || !BASE64.test(payload)) {
    throw new Error("Reve returned malformed base64 image data");
  }

  const buffer = Buffer.from(payload, "base64");
  const format = IMAGE_SIGNATURES.find(({ parts }) =>
    parts.every(({ offset, magic }) =>
      buffer.subarray(offset, offset + magic.length).equals(magic),
    ),
  );
  if (!format) {
    throw new Error("Reve returned data that is not a PNG, JPEG or WebP image");
  }
  return { buffer, mimeType: format.mimeType };
}

export function createReveProvider(apiKey: string): ProviderRegistration {
  const generate = async (params: GenerateParams): Promise<GenerateResult> => {
    const promptLength = countCodePoints(params.prompt, MAX_PROMPT_LENGTH + 1);
    if (promptLength > MAX_PROMPT_LENGTH) {
      throw new Error(
        `Reve prompt exceeds the ${MAX_PROMPT_LENGTH.toLocaleString("en-US")} character limit.`,
      );
    }

    const inputImages = params.inputImages ?? [];
    if (inputImages.length > MAX_REFERENCES) {
      throw new Error(
        `Reve accepts at most ${MAX_REFERENCES} input images (got ${inputImages.length}).`,
      );
    }

    const body: Record<string, unknown> = {
      prompt: params.prompt,
      version: params.modelId,
      aspect_ratio: params.aspectRatio,
    };
    if (inputImages.length > 0) {
      // v2 create takes raw image objects directly. The compound
      // `{ image, layout }` shape belongs to the layout endpoints only.
      body.references = inputImages.map((buf) => ({
        data: buf.toString("base64"),
      }));
    }

    // The deadline covers reading the body as well as getting the headers: a
    // multi-megabyte base64 image arrives during the body phase, so a stall
    // there is at least as likely as one during the handshake.
    let response: Response;
    let text: string;
    try {
      response = await fetch(REVE_CREATE_URL, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      // The timeout bounds how long the body may take to arrive, not how much
      // of it there is, so the size cap is applied as it streams in.
      text = await readBoundedText(response, MAX_RESPONSE_BYTES);
    } catch (err) {
      if (err instanceof Error && err.name === "TimeoutError") {
        throw new Error(
          `Reve did not respond within ${REQUEST_TIMEOUT_MS / 1000}s`,
        );
      }
      throw err;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = undefined;
    }

    if (!response.ok) {
      // Reve's errors carry a human-readable `message` plus a machine-readable
      // `error_code`. Include the request id too: it is what Reve support asks
      // for, and it is only present on the response headers.
      const error = payload as { error_code?: string; message?: string } | undefined;
      const detail = sanitizeDetail(
        typeof error?.message === "string" ? error.message : text,
      );
      const code =
        typeof error?.error_code === "string" ? ` (${sanitizeDetail(error.error_code)})` : "";
      const requestId = response.headers.get("x-reve-request-id");
      const trace = requestId ? ` [request ${sanitizeDetail(requestId)}]` : "";
      throw new Error(`Reve create failed: ${response.status}${code} ${detail}${trace}`);
    }

    const result = payload as { image?: unknown; content_violation?: unknown } | undefined;
    if (result?.content_violation) {
      throw new Error("Reve refused the prompt: content policy violation");
    }

    const { buffer, mimeType } = decodeImage(result?.image);
    return { images: [buffer], mimeType };
  };

  return {
    models: {
      // The v2 endpoints only expose the `latest` alias and always report it
      // back, so there is no dated version to pin to.
      "reve-image": "latest",
    },
    generate,
    maxInputImages: MAX_REFERENCES,
  };
}
