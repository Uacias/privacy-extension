# Privacy Extension – zk-SNARKs in a Chrome Extension

A Chrome Extension that allows secure, off-chain generation of zk-SNARK proofs (using Noir and Garaga), injected into arbitrary web apps via a `window.privacy` API – similar to `window.ethereum`.

This extension architecture allows importing libraries that require `window` (like `@aztec/bb.js`) by delegating heavy cryptographic operations to an offscreen document, while keeping the main extension logic in the background service worker.

---

## 🧩 Architecture Overview

```text
+------------------------+
| Web App (Frontend)     |
|  - Calls window.privacy|
|  - Uses PrivacyProvider|
+----------+-------------+
           |
           | window.postMessage
           v
+----------+-------------+
| Content Script          |
|  - Injects `inject.js`  |
|  - Bridges messages     |
|    between window <->   |
|    background.js        |
+----------+-------------+
           |
           | chrome.runtime.sendMessage
           v
+----------+-------------+
| Background ServiceWorker|
|  - ZK setup (ACVM, Noir)|
|  - Handles seed mgmt    |
|  - Delegates proof to   |
|    offscreen.html       |
+----------+-------------+
           |
           | chrome.offscreen API
           v
+-------------------------+
| Offscreen Document       |
|  - Has access to `window`|
|  - Loads Noir + bb.js    |
|  - Generates & verifies  |
|    zk-SNARK proofs       |
+-------------------------+
```
---

## 🧪 Dev Setup

### 1. Install

```bash
cd privacy-extension
npm install
```

### 2. Build the extension
```bash
npm run build
```
This creates: `/build` directory


### 3. Load in Chrome
```bash
chrome://extensions
Enable "Developer mode"
Click Load unpacked
Select the build/ folder
```


## Example flow - zk proof generation
```
[WEB APP]
 ↓ calls
inject.ts  → exposes window.privacy
 ↓
content.ts → bridges message
 ↓
background.ts → recognizes GENERATE_PROOF
 ↓
offscreen.ts → generates zk proof using Noir + bb.js
 ↑
background.ts ← receives result
 ↑
content.ts ← sends result to web app
 ↑
inject.ts → resolves Promise in web app
```