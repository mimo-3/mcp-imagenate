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
}
