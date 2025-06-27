import { bench, describe } from "vitest";

import { serializeComponent } from "../src/runtime/serialize";
import { serializeComponent as oldSerialize } from "../src/runtime/serialize";
import WithAsyncComponent from "virtual:vsc:./fixtures/components/WithAsyncComponent.vue";

describe("bench", () => {
  bench("serialize -- v2", async () => {
    await serializeComponent(WithAsyncComponent);
  });

  bench("serialize v1", async () => {
    await oldSerialize(WithAsyncComponent);
  });
});
