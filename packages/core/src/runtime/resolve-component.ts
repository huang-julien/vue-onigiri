import type { Component, ComponentInternalInstance } from 'vue'

export function resolveComponentInInstance(
  instance: ComponentInternalInstance | null | undefined,
  name: string,
): Component | string {
  if (!instance) return name
  const components = instance.appContext?.components as Record<string, Component> | undefined
  if (components) {
    if (name in components) return components[name]!
    const camel = name.replace(/-(\w)/g, (_, c: string) => c.toUpperCase())
    if (camel in components) return components[camel]!
    const pascal = camel.charAt(0).toUpperCase() + camel.slice(1)
    if (pascal in components) return components[pascal]!
  }
  const self = (instance.type as Component & { name?: string }).name
  if (self && (self === name || self === name.replace(/-(\w)/g, (_, c: string) => c.toUpperCase()))) {
    return instance.type as Component
  }
  return name
}

export function resolveDynamicComponentInInstance(
  instance: ComponentInternalInstance | null | undefined,
  source: unknown,
): Component | string {
  if (source && (typeof source === 'object' || typeof source === 'function')) {
    return source as Component
  }
  if (typeof source === 'string') {
    return resolveComponentInInstance(instance, source)
  }
  return 'div'
}
