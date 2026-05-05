import { bench, describe } from "vite-plus/test";

import { serializeComponent } from "../src/runtime/serialize";
import WithAsyncComponent from "virtual:vsc:./fixtures/components/WithAsyncComponent.vue";

describe("bench", () => {
  bench("serialize", async () => {
    await serializeComponent(WithAsyncComponent);
  });
});
