import { bench, describe } from "vitest";

import { serializeComponent } from "../src/runtime/serialize";
import WithAsyncComponent from "virtual:vsc:./fixtures/components/WithAsyncComponent.vue";

describe("bench", () => {
  bench("serialize", async () => {
    await serializeComponent(WithAsyncComponent);
  });
});
