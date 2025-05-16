import { fileURLToPath, URL } from 'node:url'

import { defineConfig, Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import {vueServerComponentsPlugin} from '../src/vite/chunk'

const { client, server } = vueServerComponentsPlugin({
  include: [
    './src/components/HelloWorld.vue',
  ]
})

// https://vite.dev/config/
export default defineConfig({
  plugins: [
     debugVue(vue({
      exclude: [/virtual:vsc:/, /.*\.vsc/],
      include: [/\.vue/],
    })),
    patchServerVue(vue({
      include: [/virtual:vsc:/],
    })),
    vueDevTools(),
      server,
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    },
  },
  build: {
    minify: false,
  }
})

function debugVue(plugin: Plugin): Plugin {
  const oldTransform = plugin.transform;
  plugin.transform = async function (code, id, _options) {
   if(id.includes('virtual:vsc:') ) {
    return
  }
    // @ts-expect-error ssrUtils is not a public API
    return await oldTransform.apply(this, [code, id, _options]);
  };
  const oldLoad = plugin.load;
	plugin.load = async function (id, _options) {
    if(id.includes('virtual:vsc:') ) {
      return
    }
    // @ts-expect-error ssrUtils is not a public API
		return await oldLoad.apply(this, [id, _options]);
	};
  return plugin;
}

function patchServerVue(plugin: Plugin): Plugin {
	// need to force non-ssr transform to always render vnode
 	const oldTransform = plugin.transform;
	plugin.transform = async function (code, id, _options) {
    // @ts-expect-error ssrUtils is not a public API
		return await oldTransform.apply(this, [code, id, { ssr: false }]);
	};
 	const oldLoad = plugin.load;
	plugin.load = async function (id, _options) {
 
    // @ts-expect-error ssrUtils is not a public API
		return await oldLoad.apply(this, [id, { ssr: false }]);
	};
 

	return plugin;
}