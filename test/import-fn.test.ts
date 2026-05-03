// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, Suspense } from 'vue'
import {
  provideOnigiriImportFn,
  setOnigiriImportFn,
} from '../src/runtime/utils'
import { renderOnigiri } from '../src/runtime/deserialize'
import { serializeComponent } from '../src/runtime/serialize'
import LoadComponent from './fixtures/components/LoadComponent.vue'
import Counter from './fixtures/components/Counter.vue'
import { importFn as manifestImportFn } from 'virtual:onigiri/manifest'

describe('manifest-based component loading', () => {
  afterEach(() => setOnigiriImportFn(undefined))

  it('virtual:onigiri/manifest resolves .vue modules by source path', async () => {
    const mod = await manifestImportFn('/test/fixtures/components/Counter.vue')
    expect(mod).toBeDefined()
  })

  it('virtual:onigiri/manifest throws for an unknown chunk', async () => {
    await expect(manifestImportFn('/nope.vue')).rejects.toThrow(/No loader registered/)
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
    // The Loader uses its own inner `<Suspense>` to keep server / client
    // hydration aligned, which means the outer Suspense resolves with the
    // fallback in place. Wait for the inner load to complete before
    // asserting on the rendered Counter.
    for (let i = 0; i < 20 && !wrapper.html().includes('counter'); i++) {
      await new Promise(r => setTimeout(r, 10))
    }
    expect(wrapper.html()).toContain('counter')
    expect(wrapper.html()).toContain('Increment')
  })

  it('provideOnigiriImportFn overrides the manifest at the app level', async () => {
    const ast = await serializeComponent(LoadComponent)
    let called = false
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
      {
        global: {
          plugins: [
            (app: any) => provideOnigiriImportFn(app, async () => {
              called = true
              return Counter as any
            }),
          ],
        },
      },
    )
    await promise
    expect(called).toBe(true)
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
