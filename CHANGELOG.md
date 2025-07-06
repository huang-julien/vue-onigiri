# Changelog

## v0.1.1

### 🚀 Enhancements

- Serialize + deserialize elements (7eb656b)
- Add playground (f75a022)
- Add chunk plugin (d3ef969)
- Components chunk (9ebc4ba)
- Duplicate components for vnode rendering (1f550ab)
- Provide client patched vue plugin (9bde477)
- Allow changing ouput dir for emitted files (a6909a7)
- Rework to use serialize component (5065a6e)
- Allow importing relative paths with the virtual prefix (35406c7)
- Render suspense (fe5e050)
- Use rollup createFilter() to emit client chunks (51244c4)
- Add VueApp vnode serialization (3607020)
- Serialize and deserialize slots (7dca2a7)
- Add prefix for client chunks (7bce9e1)
- Add plugin for component map injection (6650da6)
- Allow to customize import for nuxt (b8b0f79)
- Serialize all parallel (7203cec)
- V-load-client directive (ee9ccee)
- Allow to provide ssrContext to serializeComponent (a40ebc9)

### 🔥 Performance

- Directly return component loader (411c341)
- Remove children in Component and warn if chunk info is missing (59d226b)
- Remove useless check (b27d8c0)

### 🩹 Fixes

- Use Plugin type from vite instead of rollup (4d75298)
- Move new chunks into assets (3c6a799)
- Chuhnking... omfg (f4338f1)
- Remove chunks is entry (1b95894)
- Set file path of the vnode component counter part in the ssr one (99c3f08)
- Resolve component imports to vsc (dc88441)
- Vue patch environment (57b8237)
- Prefer check for raw query (nuxt) (3ad7380)
- Handle suspense and async components (3037575)
- Use getter for vue plugin options (fd527e9)
- Only await prefetches (af0bf1f)
- Await renderChild (735777e)
- Stop patching ssr vue (d6bc64d)
- Types (28597cd)
- Paths (89dc148)
- Fix filepath (c7e5862)
- Resolve using importer (fe850b9)
- Types (d7c6cdb)
- Component file load (ccd6c81)
- Remove unused property (1ea145d)
- Render component child if cannot find chunk location (7708d95)
- Prod chunks references (a492529)
- Path (7f1d597)
- Put back vue plugin patch for build time (d1c5dda)
- Add virtual file to know which chunk to load server side (055212b)
- Add virtual file to know which chunk to load server side" (b1dc17d)
- Emit chunk server side (9632a39)
- Unroll slots (6f5cb4f)
- Use return (b5eb8b7)
- Apply SSR directives correctly (289a215)
- Client-side slots and client side v-load-client (5b9665f)
- Slot rendering (78b93f3)
- Allow user to provide rootDir (5f7fb8d)

### 💅 Refactors

- Remove ?chunk (f693734)
- Use regexes (bed184e)
- Provide vue plugin SSR (fd8ee75)
- RenderComponent (765909f)
- Refactor payload to array (f916134)
- Use .then (48313c2)
- Move to Promise.resolve (1353a90)
- Rename function (7f7d8bf)

### 📖 Documentation

- README update (089070c)

### 📦 Build

- Use .js extension (c088069)

### 🏡 Chore

- **playground:** Add plugins (a07ef56)
- Console logs (ebbe2c9)
- Remove console logs (48b2fa4)
- Set server entry in playground (6951662)
- Cleaning up a bit (174b147)
- Remove overwrite fs and use import (af2a510)
- Rename (d9e7d88)
- Remove console.log (ba37b26)
- Disable unicorn/no-null (bde1e8a)
- Remove unused virtual module (7f8493e)
- Apply automated updates (358f4a3)
- Remove console.log (c4e6d5f)
- Apply automated updates (f993841)
- Apply automated updates (7e78bd7)
- Apply automated updates (0397844)
- Remove console.log (04a5b6e)
- Apply automated updates (e1f8adb)
- Remove useless vite-ignore (dc6bca2)
- Apply automated updates (0c341da)
- Apply automated updates (f3d2ab7)
- Apply automated updates (955ede5)
- Apply automated updates (f3e6647)
- Apply automated updates (9ce8d91)
- Rename package (bdf43f0)
- Add description (1053299)
- Replace serialize.ts by serializeAsync.ts (1414db2)
- Apply automated updates (130770f)
- Remove perf issues mention (1a655c1)
- Apply automated updates (f8ac27c)
- Fix typecheck (24432f7)
- Apply automated updates (065ae53)
- Restrcuture package (890924f)
- Apply automated updates (31b4bf3)
- Normalize paths (901087b)
- Apply automated updates (6040a70)
- Apply automated updates (56d12c3)
- Apply automated updates (attempt 2/3) (ce839a3)
- Apply automated updates (2f8c08a)
- Apply automated updates (dab996f)
- Remove console.log (1b85827)
- Apply automated updates (aaebb4b)
- Apply automated updates (6367745)
- Cleaning (a6ec4dc)
- Apply automated updates (2e2e0e4)
- Update LICENCE (e006d91)
- Apply automated updates (eb1e234)
- Update package info (0e48bb1)
- Apply automated updates (be4bff2)
- **release:** V0.1.0 (39370aa)
- Apply automated updates (8654719)
- Apply automated updates (06baf32)

### ✅ Tests

- WithAsyncComponent (a26b6f4)
- Fix configuration (000bbd5)
- Test component with suspense (b69a360)
- Test injection when reviving (3d4d37f)
- Use relative path (c2b9616)
- Fix snapshot (e291e31)
- Update tests (642554f)
- Mock import.meta.hot for extension usage (8f4b410)
- Add benchmark between old and new serialize (cd7406a)
- Update snapshot (ab29c79)
- Await suspense (fc7b061)

### ❤️ Contributors

- Julien Huang ([@huang-julien](https://github.com/huang-julien))

## v0.1.0

Initial POC version
