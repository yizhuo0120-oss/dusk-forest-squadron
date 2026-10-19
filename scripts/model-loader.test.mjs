import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const model = new Uint8Array(await readFile(new URL("../m2/vendor/gesture_recognizer.task", import.meta.url)));
const packedModel = new Uint8Array(await readFile(new URL("../m2/vendor/gesture_recognizer.task.gz", import.meta.url)));
const wasm = new Uint8Array(await readFile(new URL("../m2/vendor/wasm/vision_wasm_internal.wasm", import.meta.url)));
const packedWasm = new Uint8Array(await readFile(new URL("../m2/vendor/wasm/vision_wasm_internal.wasm.gz", import.meta.url)));
const NativeDecompressionStream = globalThis.DecompressionStream;
let importId = 0;

async function freshLoader() {
  globalThis.location = { href: "https://example.test/m2/index.html" };
  globalThis.DecompressionStream = NativeDecompressionStream;
  return import(`../m2/model-loader.mjs?case=${importId++}`);
}

function emptyCache() {
  globalThis.caches = { open: async () => ({ match: async () => undefined, put: async () => {} }) };
}

test("first visit transfers the compressed model once, reports progress, and caches original bytes", async () => {
  let fetches = 0;
  let stored;
  globalThis.caches = { open: async () => ({ match: async () => undefined, put: async (_, response) => { stored = new Uint8Array(await response.arrayBuffer()); } }) };
  globalThis.fetch = async (url) => {
    assert(url.endsWith(".task.gz"));
    fetches++;
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(packedModel.subarray(0, 3000000));
      controller.enqueue(packedModel.subarray(3000000));
      controller.close();
    } }));
  };
  const messages = [];
  const { loadGestureModel } = await freshLoader();
  const [first, second] = await Promise.all([
    loadGestureModel("./vendor/gesture_recognizer.task", (message) => messages.push(message)),
    loadGestureModel("./vendor/gesture_recognizer.task")
  ]);
  assert.equal(fetches, 1);
  assert.equal(first, second);
  assert.deepEqual(first, model);
  assert.deepEqual(stored, model);
  assert(messages.some((message) => message.includes("47%")));
  assert(messages.at(-1).includes("100%"));
});

test("a later visit uses persistent cache without a network request", async () => {
  globalThis.caches = { open: async () => ({ match: async () => new Response(model) }) };
  globalThis.fetch = async () => { throw new Error("The network must not be used"); };
  const { loadGestureModel } = await freshLoader();
  const messages = [];
  assert.deepEqual(await loadGestureModel("./vendor/gesture_recognizer.task", (message) => messages.push(message)), model);
  assert(messages.at(-1).includes("本机缓存"));
});

test("blocked storage permits play and a failed download can be retried", async () => {
  let fetches = 0;
  globalThis.caches = { open: async () => { throw new Error("Storage disabled"); } };
  globalThis.fetch = async () => ++fetches <= 2 ? new Response("missing", { status: 404 }) : new Response(packedModel);
  const { loadGestureModel } = await freshLoader();
  await assert.rejects(loadGestureModel("./vendor/gesture_recognizer.task"), /HTTP 404/);
  assert.deepEqual(await loadGestureModel("./vendor/gesture_recognizer.task"), model);
  assert.equal(fetches, 3);
});

test("corrupted cache is replaced; incomplete downloads cannot become a valid model", async () => {
  let deleted = false;
  globalThis.caches = { open: async () => ({ match: async () => new Response("truncated"), delete: async () => { deleted = true; } }) };
  globalThis.fetch = async () => new Response("<!doctype html><title>Not found</title>");
  const { loadGestureModel } = await freshLoader();
  await assert.rejects(loadGestureModel("./vendor/gesture_recognizer.task"), /模型文件不完整/);
  assert.equal(deleted, true);
});

test("compressed WASM decodes to the exact pinned runtime and compiles successfully", async () => {
  emptyCache();
  globalThis.fetch = async (url) => {
    assert(url.endsWith("vision_wasm_internal.wasm.gz"));
    return new Response(packedWasm);
  };
  const { loadVisionWasm } = await freshLoader();
  const result = await loadVisionWasm("./vendor/wasm/vision_wasm_internal.wasm");
  assert.deepEqual(result, wasm);
  assert(await WebAssembly.compile(result) instanceof WebAssembly.Module);
});

test("browsers without DecompressionStream download the original asset", async () => {
  emptyCache();
  const { loadGestureModel } = await freshLoader();
  globalThis.DecompressionStream = undefined;
  globalThis.fetch = async (url) => {
    assert(!url.endsWith(".gz"));
    return new Response(model);
  };
  assert.deepEqual(await loadGestureModel("./vendor/gesture_recognizer.task"), model);
  globalThis.DecompressionStream = NativeDecompressionStream;
});

test("hosting that already decodes HTTP gzip does not trigger double decompression", async () => {
  emptyCache();
  globalThis.fetch = async () => new Response(model);
  const { loadGestureModel } = await freshLoader();
  assert.deepEqual(await loadGestureModel("./vendor/gesture_recognizer.task"), model);
});

test("a network timeout is reported without starting a second long download", async () => {
  emptyCache();
  let fetches = 0;
  globalThis.fetch = async () => {
    fetches++;
    throw new DOMException("aborted", "AbortError");
  };
  const { loadGestureModel } = await freshLoader();
  await assert.rejects(loadGestureModel("./vendor/gesture_recognizer.task"), /暂时没有响应/);
  assert.equal(fetches, 1);
});
