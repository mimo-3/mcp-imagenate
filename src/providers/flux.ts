import type { GenerateParams, GenerateResult, ProviderRegistration } from "./types.js";

const ALLOWED_BFL_ORIGIN = "https://api.bfl.ai";

function assertBflUrl(url: string, label: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid ${label} URL received from FLUX API`);
  }
  if (parsed.origin !== ALLOWED_BFL_ORIGIN) {
    throw new Error(
      `${label} URL points to unexpected origin: ${parsed.origin} (expected ${ALLOWED_BFL_ORIGIN})`,
    );
  }
}

function resolveWidthHeight(
  resolution: string,
  aspectRatio: string,
): { width: number; height: number } {
  const [aw, ah] = aspectRatio.split(":").map(Number);
  const ratio = aw / ah;

  const targetPixels =
    resolution === "4K"
      ? 3_840_000
      : resolution === "2K"
        ? 2_073_600
        : 1_048_576;

  let height = Math.round(Math.sqrt(targetPixels / ratio) / 16) * 16;
  let width = Math.round((height * ratio) / 16) * 16;

  // Clamp to 4MP limit
  while (width * height > 4_000_000) {
    height -= 16;
    width = Math.round((height * ratio) / 16) * 16;
  }

  // Ensure minimums
  width = Math.max(width, 64);
  height = Math.max(height, 64);

  return { width, height };
}

async function pollForResult(
  pollingUrl: string,
  apiKey: string,
  maxAttempts = 60,
  intervalMs = 2000,
): Promise<string> {
  for (let i = 0; i < maxAttempts; i++) {
    const resp = await fetch(pollingUrl, {
      headers: { accept: "application/json", "x-key": apiKey },
    });
    if (!resp.ok) {
      throw new Error(`FLUX polling failed: ${resp.status} ${resp.statusText}`);
    }
    const data = (await resp.json()) as {
      status: string;
      result?: { sample: string };
      error?: string;
    };

    if (data.status === "Ready") {
      return data.result!.sample;
    }
    if (data.status === "Error") {
      throw new Error(`FLUX generation failed: ${data.error ?? "unknown error"}`);
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("FLUX generation timed out after polling");
}

export function createFluxProvider(apiKey: string): ProviderRegistration {
  const generate = async (params: GenerateParams): Promise<GenerateResult> => {
    if (params.inputImages?.length) {
      throw new Error("FLUX models do not support input images");
    }
    if (params.prompt.length > 3000) {
      throw new Error(
        `FLUX prompt exceeds 3,000 character limit (got ${params.prompt.length}). Shorten your prompt or use a Google/OpenAI model.`,
      );
    }

    const { width, height } = resolveWidthHeight(
      params.resolution,
      params.aspectRatio,
    );

    const submitResp = await fetch(
      `https://api.bfl.ai/v1/flux-2-${params.modelId}`,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "Content-Type": "application/json",
          "x-key": apiKey,
        },
        body: JSON.stringify({
          prompt: params.prompt,
          width,
          height,
          output_format: "png",
        }),
      },
    );

    if (!submitResp.ok) {
      const body = await submitResp.text();
      throw new Error(`FLUX submit failed: ${submitResp.status} ${body}`);
    }

    const { polling_url } = (await submitResp.json()) as {
      polling_url: string;
    };
    assertBflUrl(polling_url, "polling");

    const imageUrl = await pollForResult(polling_url, apiKey);
    assertBflUrl(imageUrl, "image download");

    const imageResp = await fetch(imageUrl);
    if (!imageResp.ok) {
      throw new Error(`Failed to download FLUX image: ${imageResp.status}`);
    }
    const buffer = Buffer.from(await imageResp.arrayBuffer());

    return { images: [buffer], mimeType: "image/png" };
  };

  return {
    models: {
      "flux-2-klein": "klein-4b",
      "flux-2-pro": "pro-preview",
      "flux-2-max": "max",
    },
    generate,
  };
}
