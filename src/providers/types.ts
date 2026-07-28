export interface GenerateParams {
  prompt: string;
  modelId: string;
  resolution: "1K" | "2K" | "4K";
  aspectRatio: string;
  mode: "image" | "image_and_text";
  thinking: "none" | "auto";
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
}
