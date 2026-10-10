import { createApp, createSSRApp } from "vue";
import { renderOnigiri } from "../../src/runtime/deserialize";
import type { OnigiriPayload } from "../../src/runtime/shared";
import { loadGenerated, measure, readParams } from "./page";

const { rows, mode } = readParams();
const root = document.querySelector<HTMLElement>("#app")!;
const { payload, onigiriHtml } = await loadGenerated(rows);

if (mode === "hydrate") root.innerHTML = onigiriHtml;

const create = mode === "hydrate" ? createSSRApp : createApp;
measure(() => create({ render: () => renderOnigiri(payload as OnigiriPayload) }).mount(root));
