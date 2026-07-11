import { expect } from "vite-plus/test";

/** Assert the emitted module body parses as JavaScript. */
export const expectParses = (code: string): void => {
  const body = code.replace(/^import[^\n]*$/gm, "").replace(/^export /m, "");
  expect(() => new Function(body)).not.toThrow();
};
