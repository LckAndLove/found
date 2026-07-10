---
name: tauri_updater_signing
description: Guidelines and troubleshooting for Tauri 2.0 auto-updater configuration, signing, and GitHub Actions workflow setup.
---
# Tauri 2.0 Auto-Updater & Signing Guide

This skill provides the absolute guidelines, pitfalls, and troubleshooting steps for setting up Tauri 2.0 auto-updater and code signing.

## 1. Required Configuration in `tauri.conf.json`

To enable the generation of `.sig` signature files and updater archives (`.tar.gz` for macOS, `.zip` for Windows) during a build:
1. **Force Updater Artifact Generation**:
   Add `"createUpdaterArtifacts": true` inside the `"bundle"` section of `tauri.conf.json`.
   ```json
   "bundle": {
     "createUpdaterArtifacts": true,
     "targets": "all"
   }
   ```
2. **Public Key Format (Crucial)**:
   The `"pubkey"` inside the `"plugins" > "updater"` section must be the **base64-encoded** version of your Minisign `.pub` key file.
   * *Correct:* `"pubkey": "dW50cnVzdGVkIGNvbW1lbnQ6..."`
   * *Incorrect (will fail to compile with "Invalid symbol 32" error):* `"pubkey": "untrusted comment: minisign public key..."`

## 2. GitHub Secrets Setup

1. **Repository Secret Name**: Add the private key contents under the header **Repository secrets** (not Environment secrets) as `TAURI_SIGNING_PRIVATE_KEY`.
2. **Do Not Add as Variable**: Adding private key as a Variable will expose it in plaintext logs. Always use a Secret.

## 3. GitHub Actions Environment Variable Mapping

In your workflow file (e.g. `release.yml`), when running `tauri-apps/tauri-action`, map both `TAURI_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY` to the secret to ensure compatibility with both the wrapper action and the Tauri 2.0 compiler:
```yaml
- name: Build Tauri app
  uses: tauri-apps/tauri-action@v0
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    TAURI_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
    TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
```

## 4. Extracting and Publishing Signatures (`update.json`)

To automate update checking, you need to extract the `.sig` files uploaded to GitHub releases and write them to a static `update.json` file in your repository:
1. Find all `.sig` and updater bundles recursively or via targeted lookup.
2. The format for `update.json` for Tauri 2.0 is:
```json
{
  "version": "0.1.0",
  "notes": "Release notes here",
  "pub_date": "ISO-8601-Date",
  "platforms": {
    "darwin-aarch64": {
      "signature": "Content of macOS .sig file (base64 string)",
      "url": "https://github.com/owner/repo/releases/download/v0.1.0/_aarch64.app.tar.gz"
    },
    "windows-x86_64": {
      "signature": "Content of Windows .sig file (base64 string)",
      "url": "https://github.com/owner/repo/releases/download/v0.1.0/_0.1.0_x64-setup.exe"
    }
  }
}
```
