import { vi } from "vitest";

vi.stubGlobal("mockedFn", vi.fn());

// vmForks gives each test file its own realm but copies TextEncoder from
// the host, so its Uint8Array output fails this realm's `instanceof` —
// which esbuild asserts at import (needed by build-e2e's `vite build`).
// Re-wrap encode() results into this realm's Uint8Array.
const hostEncode = TextEncoder.prototype.encode;
if (!(hostEncode.call(new TextEncoder(), "") instanceof Uint8Array)) {
  TextEncoder.prototype.encode = function (input: string) {
    return new Uint8Array(hostEncode.call(this, input));
  };
}
