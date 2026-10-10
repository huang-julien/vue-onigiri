import { createApp, createSSRApp } from "vue";
import Tree from "../fixtures/Tree.vue";
import { loadGenerated, measure, readParams } from "./page";

const { rows, mode } = readParams();
const root = document.querySelector<HTMLElement>("#app")!;

if (mode === "hydrate") root.innerHTML = (await loadGenerated(rows)).vueHtml;

const create = mode === "hydrate" ? createSSRApp : createApp;
measure(() => create(Tree, { count: rows }).mount(root));
