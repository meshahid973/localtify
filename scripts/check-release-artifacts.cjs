"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { version } = require("../package.json");

function isReleaseArtifact(filename, releaseVersion, platform) {
  if (platform === "win32") return filename === "localtify-setup-" + releaseVersion + ".exe";
  if (platform === "linux") return filename.startsWith("localtify-" + releaseVersion + "-") && filename.endsWith(".AppImage");
  return false;
}

function verifyBundledLastfmKey(root, expectedKey, platform = process.platform) {
  const key = String(expectedKey || "").trim();
  assert.ok(/^[a-f0-9]{32}$/i.test(key), "Official releases require a Last.fm application key");
  assert.ok(platform === "win32" || platform === "linux", "Unsupported release verification platform");
  const directory = platform === "win32" ? "win-unpacked" : "linux-unpacked";
  const providerFile = path.join(root, "release", directory, "resources", "provider-defaults.json");
  const defaults = JSON.parse(fs.readFileSync(providerFile, "utf8"));
  assert.ok(Object.keys(defaults).length === 1 && defaults.lastfmApiKey === key,
    "Packaged Last.fm configuration must contain exactly the configured public application key");
  console.log("[release-artifact] verified bundled Last.fm application key");
}

function verifyReleaseArtifact(root = path.resolve(__dirname, "..")) {
  assert.match(version, /^\d+\.\d+\.\d+$/, "Stable release version expected");
  const output = path.join(root, "release");
  assert.ok(fs.existsSync(output), "Missing release output directory");
  const files = fs.readdirSync(output).filter((name) => isReleaseArtifact(name, version, process.platform));
  assert.equal(files.length, 1, "Expected exactly one " + process.platform + " installer for " + version);
  const file = path.join(output, files[0]);
  const bytes = fs.statSync(file).size;
  assert.ok(bytes > 10_000_000, "Installer is unexpectedly small: " + bytes + " bytes");
  if (process.env.LOCALTIFY_REQUIRE_LASTFM_KEY === "1") verifyBundledLastfmKey(root, process.env.LOCALTIFY_LASTFM_API_KEY);
  console.log("[release-artifact] verified " + files[0] + " (" + bytes + " bytes)");
}

if (require.main === module) verifyReleaseArtifact();

module.exports = { isReleaseArtifact, verifyReleaseArtifact, verifyBundledLastfmKey };
