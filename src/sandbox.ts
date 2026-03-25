import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export function isInsideBase(resolved: string, base: string): boolean {
  return resolved === base || resolved.startsWith(base + path.sep);
}

export function getDefaultOutputBaseDir(): string {
  return path.join(os.homedir(), "mcp-imagenate-output");
}

export function resolveOutputDir(
  outputDir: string,
  outputBaseDir: string | null,
): string {
  if (outputBaseDir !== null) {
    const resolved = path.resolve(outputBaseDir, outputDir);
    if (!isInsideBase(resolved, outputBaseDir)) {
      throw new Error(
        `outputDir is outside the allowed base directory (NANO_BANANA_OUTPUT_DIR=${outputBaseDir})`,
      );
    }

    // If the resolved path already exists, follow symlinks and re-check
    try {
      const realPath = fs.realpathSync(resolved);
      if (!isInsideBase(realPath, fs.realpathSync(outputBaseDir))) {
        throw new Error(
          `outputDir resolves outside the allowed base directory (symlink?): ${outputDir}`,
        );
      }
    } catch (err) {
      // Directory doesn't exist yet — that's fine, mkdir will create it later
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err;
      }
    }

    return resolved;
  }
  return path.resolve(outputDir);
}

export const MAX_INPUT_IMAGE_SIZE = 20 * 1024 * 1024; // 20 MB

export function resolveInputImagePath(
  imagePath: string,
  outputBaseDir: string | null,
): string {
  const resolved = path.resolve(imagePath);

  // When outputBaseDir is set, input images must also be inside it
  if (outputBaseDir !== null && !isInsideBase(resolved, outputBaseDir)) {
    throw new Error(
      `Input image path is outside the allowed base directory: ${imagePath}`,
    );
  }

  // Follow symlinks and re-check
  let realPath: string;
  try {
    realPath = fs.realpathSync(resolved);
  } catch {
    throw new Error(`Could not resolve input image path: ${imagePath}`);
  }
  if (
    outputBaseDir !== null &&
    !isInsideBase(realPath, fs.realpathSync(outputBaseDir))
  ) {
    throw new Error(
      `Input image path resolves outside the allowed base directory (symlink?): ${imagePath}`,
    );
  }

  return realPath;
}
