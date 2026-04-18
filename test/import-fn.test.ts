// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, Suspense } from 'vue'
import { setOnigiriImportFn } from '../src/runtime/utils'
import { renderOnigiri } from '../src/runtime/deserialize'
import { serializeComponent } from '../src/runtime/serialize'
import LoadComponent from './fixtures/components/LoadComponent.vue'
import { importFn as manifestImportFn } from 'virtual:onigiri/manifest'

describe('manifest-based component loading', () => {
  afterEach(() => setOnigiriImportFn(undefined))

  it('virtual:onigiri/manifest resolves .vue modules by source path', async () => {
    const mod = await manifestImportFn('/test/fixtures/components/Counter.vue')
    expect(mod).toBeDefined()
  })

  it('virtual:onigiri/manifest throws for an unknown chunk', async () => {
    await expect(manifestImportFn('/nope.vue')).rejects.toThrow(/No component registered/)
  })

  it('renderOnigiri loads a client-loaded component via the default manifest', async () => {
    const ast = await serializeComponent(LoadComponent)
    const { promise, resolve } = Promise.withResolvers<boolean>()
    const wrapper = mount(
      defineComponent({
        setup() {
          return () => h(
            Suspense,
            { onResolve: () => resolve(true) },
            { default: () => renderOnigiri(ast) },
          )
        },
      }),
    )
    await promise
    expect(wrapper.html()).toContain('counter')
    expect(wrapper.html()).toContain('Increment')
  })

  it('setOnigiriImportFn overrides the manifest resolver', async () => {
    const ast = await serializeComponent(LoadComponent)
    let called = false
    setOnigiriImportFn(async (src, exportName = 'default') => {
      called = true
      const mod: any = await import(/* @vite-ignore */ src)
      return mod[exportName] ?? mod.default ?? mod
    })
    const { promise, resolve } = Promise.withResolvers<boolean>()
    mount(
      defineComponent({
        setup() {
          return () => h(
            Suspense,
            { onResolve: () => resolve(true) },
            { default: () => renderOnigiri(ast) },
          )
        },
      }),
    )
    await promise
    expect(called).toBe(true)
  })
})
