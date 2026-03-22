import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { resolveOutputDir, resolveInputImagePath } from "../src/sandbox.js";

describe("resolveOutputDir", () => {
  it("resolves relative path without base dir", () => {
    const result = resolveOutputDir("output", null);
    assert.equal(result, path.resolve("output"));
  });

  it("resolves relative path within base dir", () => {
    const base = "/tmp/sandbox-test-base";
    const result = resolveOutputDir("sub/dir", base);
    assert.equal(result, path.join(base, "sub/dir"));
  });

  it("allows exact base dir", () => {
    const base = "/tmp/sandbox-test-base";
    const result = resolveOutputDir(".", base);
    assert.equal(result, base);
  });

  it("rejects path traversal above base dir", () => {
    const base = "/tmp/sandbox-test-base";
    assert.throws(
      () => resolveOutputDir("../../etc", base),
      /outside the allowed base directory/,
    );
  });

  it("rejects absolute path outside base dir", () => {
    const base = "/tmp/sandbox-test-base";
    assert.throws(
      () => resolveOutputDir("/etc/passwd", base),
      /outside the allowed base directory/,
    );
  });
});

describe("resolveInputImagePath", () => {
  let tmpDir: string;
  let testImagePath: string;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-imagenate-test-"));
    testImagePath = path.join(tmpDir, "test.png");
    // Write a minimal valid file
    fs.writeFileSync(testImagePath, Buffer.from("fake-png-data"));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("resolves valid file inside base dir", () => {
    const result = resolveInputImagePath(testImagePath, tmpDir);
    assert.equal(result, fs.realpathSync(testImagePath));
  });

  it("allows any path when no base dir is set", () => {
    const result = resolveInputImagePath(testImagePath, null);
    assert.equal(result, fs.realpathSync(testImagePath));
  });

  it("rejects path outside base dir", () => {
    const otherDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "mcp-imagenate-other-"),
    );
    const otherFile = path.join(otherDir, "other.png");
    fs.writeFileSync(otherFile, Buffer.from("data"));

    try {
      assert.throws(
        () => resolveInputImagePath(otherFile, tmpDir),
        /outside the allowed base directory/,
      );
    } finally {
      fs.rmSync(otherDir, { recursive: true, force: true });
    }
  });

  it("rejects path traversal via ../", () => {
    assert.throws(
      () => resolveInputImagePath(path.join(tmpDir, "..", "etc", "passwd"), tmpDir),
      /outside the allowed base directory/,
    );
  });

  it("rejects symlink that escapes base dir", () => {
    const outsideFile = path.join(os.tmpdir(), "mcp-imagenate-outside.png");
    fs.writeFileSync(outsideFile, Buffer.from("outside-data"));

    const symlinkPath = path.join(tmpDir, "sneaky-link.png");
    fs.symlinkSync(outsideFile, symlinkPath);

    try {
      assert.throws(
        () => resolveInputImagePath(symlinkPath, tmpDir),
        /resolves outside the allowed base directory/,
      );
    } finally {
      fs.unlinkSync(symlinkPath);
      fs.unlinkSync(outsideFile);
    }
  });

  it("rejects nonexistent file", () => {
    assert.throws(
      () => resolveInputImagePath(path.join(tmpDir, "nope.png"), tmpDir),
      /Could not resolve input image path/,
    );
  });
});
