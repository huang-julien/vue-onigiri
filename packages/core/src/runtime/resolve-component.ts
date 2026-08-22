import type { Component, ComponentInternalInstance } from "vue";
import { camelize, capitalize } from "@vue/shared";

function lookup(
  registry: Record<string, Component> | undefined,
  name: string,
): Component | undefined {
  if (!registry) return undefined;
  if (name in registry) return registry[name];
  const camel = camelize(name);
  if (camel in registry) return registry[camel];
  const pascal = capitalize(camel);
  if (pascal in registry) return registry[pascal];
  return undefined;
}

export function resolveComponentInInstance(
  instance: ComponentInternalInstance | null | undefined,
  name: string,
): Component | string {
  if (!instance) return name;

  const resolved =
    lookup((instance.type as any)?.components, name) ??
    lookup(instance.appContext?.components as Record<string, Component> | undefined, name);
  if (resolved) return resolved;

  const self = (instance.type as Component & { name?: string }).name;
  if (self && (self === name || self === camelize(name))) {
    return instance.type as Component;
  }
  return name;
}

export function resolveDynamicComponentInInstance(
  instance: ComponentInternalInstance | null | undefined,
  source: unknown,
): Component | string {
  if (source && (typeof source === "object" || typeof source === "function")) {
    return source as Component;
  }
  if (typeof source === "string") {
    return resolveComponentInInstance(instance, source);
  }
  return "div";
}
