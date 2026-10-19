// Download compressed assets where supported, then cache their original bytes.
// Storage failures must not prevent play (e.g. private browsing or a full disk).
const CACHE_NAME = "dusk-forest-gesture-v1";
const pending = new Map();
const MODEL = { bytes: 8373440, packedBytes: 6320973, label: "手势模型" };
const WASM = {
  "vision_wasm_internal.wasm": { bytes: 9423986, packedBytes: 2857519 },
  "vision_wasm_nosimd_internal.wasm": { bytes: 9294247, packedBytes: 2853913 }
};

export function loadGestureModel(path, onProgress = () => {}) {
  return loadAsset(path, MODEL, onProgress);
}

export function loadVisionWasm(path, onProgress = () => {}) {
  const filename = new URL(path, location.href).pathname.split("/").pop();
  const spec = WASM[filename];
  if (!spec) return Promise.reject(new Error("识别运行文件版本不匹配"));
  return loadAsset(path, { ...spec, label: "识别引擎" }, onProgress);
}

function loadAsset(path, spec, onProgress) {
  const url = new URL(path, location.href).href;
  if (!pending.has(url)) {
    pending.set(url, readAsset(url, spec, onProgress).catch((error) => {
      pending.delete(url);
      throw error;
    }));
  }
  return pending.get(url);
}

async function readAsset(url, spec, onProgress) {
  let cache;
  try {
    cache = await caches.open(CACHE_NAME);
    const response = await cache.match(url);
    if (response) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength === spec.bytes) {
        onProgress(`${spec.label}：已读取本机缓存`);
        return bytes;
      }
      await cache.delete(url);
    }
  } catch {
    // Continue when this browser cannot use persistent storage.
  }

  let bytes;
  if (typeof DecompressionStream === "function") {
    const packedUrl = new URL(url);
    packedUrl.pathname += ".gz";
    try {
      bytes = await download(packedUrl.href, spec.packedBytes, spec.label, onProgress);
      // Some hosts apply Content-Encoding themselves. Avoid decompressing twice.
      if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
        onProgress(`${spec.label}：下载完成，正在解压…`);
        const decoded = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
        bytes = new Uint8Array(await new Response(decoded).arrayBuffer());
      }
      if (bytes.byteLength !== spec.bytes) {
        throw Object.assign(new Error("压缩文件不完整"), { packedUnavailable: true });
      }
    } catch (error) {
      // Older deployments may not have packed files. Timeouts are reported
      // directly so they do not silently start another long download.
      if (![404, 415].includes(error.status) && !error.packedUnavailable) throw error;
    }
  }
  if (!bytes || bytes.byteLength !== spec.bytes) {
    bytes = await download(url, spec.bytes, spec.label, onProgress);
  }
  if (bytes.byteLength !== spec.bytes) {
    throw new Error(`${spec.label}文件不完整，请检查部署文件或重试`);
  }
  onProgress(`${spec.label}：准备完成 100%`);
  try {
    await cache?.put(url, new Response(bytes, {
      headers: { "Content-Type": "application/octet-stream" }
    }));
  } catch {
    // Downloaded bytes remain usable even if saving the cache fails.
  }
  return bytes;
}

async function download(url, total, label, onProgress) {
  const controller = new AbortController();
  let timeout;
  const resetTimeout = () => {
    clearTimeout(timeout);
    timeout = setTimeout(() => controller.abort(), 30000);
  };
  onProgress(`${label}：下载 0% · 约 ${(total / 1000000).toFixed(1)} MB`);
  resetTimeout();
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw Object.assign(new Error(`${label}下载失败（HTTP ${response.status}），请重试`), { status: response.status });
    }
    if (!response.body?.getReader) return new Uint8Array(await response.arrayBuffer());
    const reader = response.body.getReader();
    const chunks = [];
    let loaded = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      resetTimeout();
      chunks.push(value);
      loaded += value.byteLength;
      const percent = Math.min(99, Math.floor(loaded / total * 100));
      onProgress(`${label}：下载 ${percent}% · ${(loaded / 1000000).toFixed(1)} / ${(total / 1000000).toFixed(1)} MB`);
    }
    const bytes = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`${label}下载暂时没有响应，请检查网络后重试`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
