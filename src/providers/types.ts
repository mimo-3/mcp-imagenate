/**
 * What the image sits on. `transparent` asks for an alpha channel, which only
 * some providers can deliver — see
 * `ProviderRegistration.supportsTransparentBackground`.
 */
export type Background = "auto" | "transparent" | "opaque";

export interface GenerateParams {
  prompt: string;
  modelId: string;
  resolution: "1K" | "2K" | "4K";
  aspectRatio: string;
  mode: "image" | "image_and_text";
  thinking: "none" | "auto";
  background: Background;
  inputImages?: Buffer[];
  inputImageMimeTypes?: string[];
}

export interface GenerateResult {
  images: Buffer[];
  mimeType: string;
  description?: string;
}

export type ProviderFn = (params: GenerateParams) => Promise<GenerateResult>;

export interface ProviderRegistration {
  models: Record<string, string>;
  generate: ProviderFn;
  /**
   * How many input images the provider accepts. Callers use this to reject an
   * oversized request before reading any of the files off disk; omit it when
   * the provider has no documented limit.
   */
  maxInputImages?: number;
  /**
   * Whether the provider can return an image with an alpha channel
   * (`background: "transparent"`). Callers reject a transparent request aimed
   * at a provider without it instead of letting the request through and
   * handing back a silently opaque image; omit it when the provider cannot.
   */
  supportsTransparentBackground?: boolean;
}
