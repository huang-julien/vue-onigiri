# Changelog

## v0.6.0

[compare changes](https://undefined/undefined/compare/v0.2.0...v0.6.0)

### 🚀 Enhancements

- Test adding compiler (8e03378)
- Fixes (068fb0a)
- **playground:** Update playground (550715a)
- Implement compiler with vite plugin (6704adb)
- Handle directives (0f2d489)
- Correctly handle slots (d9065f8)
- Use manifest (4f9477d)
- Migrate to vp (8a345aa)
- Improve chunks (7629cee)
- **compiler:** Resolve v-load-client imports through the bundler resolver (4a2f64a)
- ⚠️  Add versioningh (60daea9)
- Handle teleeport (14db79b)
- Add component detection for manifest (7cec408)
- Add extraEntries to extend manifest (b01fcfa)
- **vite:** Allow auto in manifest include array (fb85b53)
- Compile the onigiri render from the pipeline source (b58d614)

### 🔥 Performance

- Return subtree if available (d8ce5b0)
- Mark pure (8564118)
- Build-time __DEV__ check for unserializable prop warning (09ae1c0)

### 🩹 Fixes

- **vite:** Fix export info transformation client side and use let instead of const (a8b18ee)
- Fix component child serialization (df63d65)
- Add virtual:vue-onigiri for component import (040bb90)
- **runtime:** Add missing provide ctx + fix component rendering component (355388d)
- Correctly extract slots contents (8acf649)
- **runtime:** Send parentInstance to slots (8abdf3f)
- Chunks (c2a7ac2)
- Handle slots correctly (bf21c1b)
- Seems to work (8af2402)
- Handle dev-prod differences like in vue (39e7eea)
- Handle scope ID (201119a)
- Use vue's __DEV__ (37146cd)
- Types (c5dba5a)
- Types and augmentations (5bc49da)
- Move slot from desierialization to serialization time (faec7c8)
- Remake runtime + restructure compiler (4e90ca8)
- Tyopes (1d9ef57)
- **compiler:** Fix control flow and shorthands expressions (1227bbf)
- Production builds (64db296)
- **compiler:** Export resolve and TDZ (62d1067)
- **compiler:** Correct codegen for comments, v-for/slot scoping, dynamic args (8f32335)
- **compiler:** Bridge literal-const setup bindings in the inline render (6439ff4)
- **runtoime:** Fix injection (69c4a5b)
- Correctly handle diffent v-for shape (03a5149)
- Class stle merge (773730f)
- Expand v-model (8ddbd27)
- Use toDisplayString to render interpolation (ad9a0c5)
- Add fallback children for suspense (d881046)
- V-on modifuier (324cbc4)
- Type cleanup (f5c371f)
- Improve chunk loading, payload inlining and prop transfer (6171fcd)
- **runtime:** Fix loader staleness from payload swap (57af960)
- Resolve directive from app or instance (e2b04ce)
- Correctly serialize vmodel values for (4f7a310)
- Paths (4de25e8)
- Count root node for staticVnode (f6fa415)
- **runtime:** Resolve local component first (8edf06b)
- **runtime:** Degrade gracefully when a chunk fails to load (414461f)
- **vite:** Derive import map from compileScript bindings instead of regex parsing (d6cceaa)
- **compiler:** Escape template-derived strings in generated code and derive script imports from bindings (71779f7)
- **vite:** Reject cross-origin in the manifest import fallback (403c91b)
- Correctly serialize subtree (af8d61a)
- **manifest:** Mathc bare importer path (18f659d)

### 💅 Refactors

- Refacto chunks (fb84043)
- Remove chukn plugin (dca80e1)
- Restructure repo (9d29ccb)
- ⚠️  Remove ABSOLUTE_CHUNK_RE in manifest (7a62def)
- **vite:** Move manifest runtime into a real module (d88df41)
- **runtime:** Extract runSetup and onigiriRenderOf helpers (5003fd5)
- ⚠️  Split the compiler into single-responsibility plugins (ac64d76)

### 🏡 Chore

- Fix playground (f505d6f)
- Upsdate playground (a6b420c)
- Update playground (0172ca3)
- Add estree types (f3b505f)
- Lint (a7ffbd2)
- **deps-dev:** Bump happy-dom from 17.4.6 to 20.0.0 (2feb8d4)
- Lint and migrate to stylistic (48bfcd3)
- Exclude playground from tsconfig (80266c8)
- Update deps (e13c58d)
- 0.3.0 (6df6515)
- 0.3.1 (73bdbfb)
- 0.3.2 (4dec1ea)
- Remove vite-plus (a3c201e)
- 0.4.0 (97541de)
- Deps cleanup (407a216)
- Cleanup (f674264)
- 0.4.1 (7e5c0bb)
- Cleanup (b4ffebc)
- Use compileOnigiriInline in compileOnigiri (006e563)
- **vite:** Share sfc analysis and compile options between load-virtual and inject-setup (3a16269)
- **compiler:** Extract genNodeList and genFragment child-list helpers (b5e1bfd)
- Migrate to oxfmt + oxlint (b309f7b)
- Update CHANGELOG (c189195)
- Update README with motivation (15d5f87)
- Update comments (3e1858a)
- Cleanup (e52c923)
- Move README in repo root (c53c559)
- 0.5.0 (7ebd893)
- 0.5.1 (c83be03)
- Split README (28ad6eb)
- Exclude all fixtures from tsconfig (168f246)
- Lint (d95aae3)
- Remove all fixtures from tsconfig (7e8bf72)
- Lint (75b5fdd)
- Fix release script (d56038a)

### ✅ Tests

- Cover more cases (42a7d59)
- Cover global component resolution through serialize (4014572)
- Update snapshots (fb30e56)
- Add hydrtation test (0fb7cce)
- Add security tests (75a55ad)
- Add snapshots (bd12d3d)

#### ⚠️ Breaking Changes

- ⚠️  Add versioningh (60daea9)
- ⚠️  Remove ABSOLUTE_CHUNK_RE in manifest (7a62def)
- ⚠️  Split the compiler into single-responsibility plugins (ac64d76)

### ❤️ Contributors

- Julien Huang ([@huang-julien](https://github.com/huang-julien))

## v0.4.1

[compare changes](https://github.com/huang-julien/vue-cryo/compare/v0.4.0...v0.4.1)

### 🚀 Enhancements

- ⚠️ Add payload versioning (60daea9)
- Handle teleport (14db79b)
- **compiler:** Resolve v-load-client imports through the bundler resolver (4a2f64a)

### 🔥 Performance

- Build-time `__DEV__` check for unserializable prop warning (09ae1c0)
- Mark pure (8564118)

### 🩹 Fixes

- Improve chunk loading, payload inlining and prop transfer (6171fcd)
- **runtime:** Fix loader staleness from payload swap (57af960)
- Resolve directive from app or instance (e2b04ce)
- Correctly serialize v-model values (4f7a310)
- Paths (4de25e8)
- Count root node for staticVnode (f6fa415)
- **runtime:** Resolve local component first (8edf06b)
- Type cleanup (f5c371f)

### 💅 Refactors

- **runtime:** Remove inheritAppContext and slot reconstruction (8fa31fb)

### 🏡 Chore

- Deps cleanup (407a216)
- Cleanup (f674264)

### ✅ Tests

- Add hydration test (0fb7cce)
- Add security tests (75a55ad)

#### ⚠️ Breaking Changes

- ⚠️ Add payload versioning (60daea9)

## v0.4.0

[compare changes](https://github.com/huang-julien/vue-cryo/compare/v0.3.2...v0.4.0)

### 🩹 Fixes

- **compiler:** Correct codegen for comments, v-for/slot scoping, dynamic args (8f32335)
- **compiler:** Bridge literal-const setup bindings in the inline render (6439ff4)
- **runtime:** Fix injection (69c4a5b)
- Correctly handle different v-for shapes (03a5149)
- Class/style merge (773730f)
- Expand v-model (8ddbd27)
- Use toDisplayString to render interpolation (ad9a0c5)
- Add fallback children for suspense (d881046)
- v-on modifiers (324cbc4)

### 🏡 Chore

- Remove vite-plus (a3c201e)

### ✅ Tests

- Cover global component resolution through serialize (4014572)
- Update snapshots (fb30e56)
- Split compiler tests (ba5ad16)

## v0.3.2

[compare changes](https://github.com/huang-julien/vue-cryo/compare/v0.3.1...v0.3.2)

### 💅 Refactors

- ⚠️ Remove ABSOLUTE_CHUNK_RE in manifest (7a62def)

#### ⚠️ Breaking Changes

- ⚠️ Remove ABSOLUTE_CHUNK_RE in manifest (7a62def)

## v0.3.1

[compare changes](https://github.com/huang-julien/vue-cryo/compare/v0.3.0...v0.3.1)

### 🚀 Enhancements

- Improve chunks (7629cee)

### 🩹 Fixes

- **compiler:** Fix control flow and shorthand expressions (1227bbf)
- Handle templateless SFC and async components in serializeApp (e9ea91c)
- Production builds (64db296)
- **compiler:** Export resolve and TDZ (62d1067)

### ✅ Tests

- Update snapshots, add async component and render setup tests (483232b)

## v0.3.0

[compare changes](https://github.com/huang-julien/vue-cryo/compare/v0.2.1...v0.3.0)

### 🚀 Enhancements

- Implement compiler with vite plugin (6704adb)
- Handle directives (0f2d489)
- Correctly handle slots (d9065f8)
- Use manifest (4f9477d)
- Migrate to vp (8a345aa)

### 🩹 Fixes

- Handle slots correctly (bf21c1b)
- Handle dev-prod differences like in vue (39e7eea)
- Handle scope ID (201119a)
- Use vue's `__DEV__` (37146cd)
- Types and augmentations (5bc49da)
- Move slot from deserialization to serialization time (faec7c8)
- Remake runtime + restructure compiler (4e90ca8)
- Types (1d9ef57)
- Incomplete multi-character sanitization (dc4c7eb)

### 💅 Refactors

- Refacto chunks (fb84043)
- Prefer onigiri render fn (9ada6d7)
- Remove chunk plugin (dca80e1)
- Restructure repo (9d29ccb)

### 🏡 Chore

- Lint and migrate to stylistic (48bfcd3)
- Exclude playground from tsconfig (80266c8)
- Update deps (e13c58d)
- **deps:** Update majors (4634a74)

### ✅ Tests

- Cover more cases (42a7d59)

## v0.2.1

[compare changes](https://github.com/huang-julien/vue-cryo/compare/v0.2.0...v0.2.1)

### 🚀 Enhancements

- Test adding compiler (8e03378)

### 🔥 Performance

- Return subtree if available (d8ce5b0)

### 🩹 Fixes

- **vite:** Fix export info transformation client side and use let instead of const (a8b18ee)
- Fix component child serialization (df63d65)
- Add virtual:vue-onigiri for component import (040bb90)
- **runtime:** Add missing provide ctx + fix component rendering component (355388d)
- Fix client side component children serialization (3c94b4a)
- Correctly extract slots contents (8acf649)
- **runtime:** Fix ref (6fbdaed)
- **runtime:** Send parentInstance to slots (8abdf3f)
- Chunks (c2a7ac2)

### 🏡 Chore

- Add estree types (f3b505f)
- Lint (a7ffbd2)

## v0.2.0

[compare changes](https://undefined/undefined/compare/v0.1.1...v0.2.0)

### 🚀 Enhancements

- Expose emitted client chunks and override vue plugin config hook (696d4f1)
- ⚠️ Add export name to components serialization (cff3efc)
- Emit virtual:vue-onigiri for server-client chunk (8666906)

### 🩹 Fixes

- Don't serialize listeners (21877a5)
- Types (8a74d23)
- Revert config hook (d964ad5)
- Patched vue (af191da)
- Fix vue patch (c5a0a4c)
- **chunk:** Fix server-side export name (b8f4887)
- Provide emitted server side chunks (601f69f)
- Use direct import in virtual:vue-onigiri (5e209dc)
- Change export name (1c5494d)

### 🏡 Chore

- Apply automated updates (f2c011c)
- Apply automated updates (821fbb6)
- Lint (ee6ce65)
- Apply automated updates (8fdf822)
- Apply automated updates (de1919c)
- Apply automated updates (d94ae77)
- Remove console (f52269a)
- Remove nitrofix (c360675)
- Remove console log (a9efa9a)

### ✅ Tests

- Provide rootDir (c4454a6)
- Remove old impl (1c35e56)
- Update snapshots (525970f)

### 🤖 CI

- **autofix:** Remove it for now (f40f18f)

#### ⚠️ Breaking Changes

- ⚠️ Add export name to components serialization (cff3efc)

### ❤️ Contributors

- Julien Huang ([@huang-julien](https://github.com/huang-julien))

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
