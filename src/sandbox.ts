import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export function isInsideBase(resolved: string, base: string): boolean {
  return resolved === base || resolved.startsWith(base + path.sep);
}

/**
 * Canonical path of `target`, or of its nearest ancestor that exists.
 *
 * Plain realpath throws ENOENT for a path we are about to create, and simply
 * skipping the check in that case leaves a hole: with `base/link` pointing
 * outside, `base/link/newdir` looks in-bounds as a string, fails realpath
 * because the leaf is missing, and then mkdir -p happily follows the symlink
 * out of the sandbox. Resolving the nearest existing ancestor instead catches
 * that, because `base/link` itself does resolve.
 */
function realpathNearestExisting(target: string): string {
  let current = target;
  for (;;) {
    try {
      return fs.realpathSync(current);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      const parent = path.dirname(current);
      if (parent === current) return current; // reached the filesystem root
      current = parent;
    }
  }
}

export function getDefaultOutputBaseDir(): string {
  return path.join(os.homedir(), "mcp-imagenate-output");
}

export function resolveOutputDir(
  outputDir: string,
  outputBaseDir: string | null,
): string {
  if (outputBaseDir !== null) {
    // Resolve the base too: a relative base would otherwise never match the
    // always-absolute resolved path, rejecting every path out of hand.
    const base = path.resolve(outputBaseDir);
    const resolved = path.resolve(base, outputDir);
    if (!isInsideBase(resolved, base)) {
      throw new Error(
        `outputDir is outside the allowed base directory (NANO_BANANA_OUTPUT_DIR=${outputBaseDir})`,
      );
    }

    // Re-check after following symlinks. The target usually does not exist yet
    // (mkdir creates it later), so compare the nearest existing ancestor.
    if (!isInsideBase(realpathNearestExisting(resolved), realpathNearestExisting(base))) {
      throw new Error(
        `outputDir resolves outside the allowed base directory (symlink?): ${outputDir}`,
      );
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
  // Resolve the base for the same reason as in resolveOutputDir.
  const base = outputBaseDir === null ? null : path.resolve(outputBaseDir);

  // When a base is set, input images must also be inside it
  if (base !== null && !isInsideBase(resolved, base)) {
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
  if (base !== null && !isInsideBase(realPath, realpathNearestExisting(base))) {
    throw new Error(
      `Input image path resolves outside the allowed base directory (symlink?): ${imagePath}`,
    );
  }

  return realPath;
}
