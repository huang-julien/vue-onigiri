import { SourceMapGenerator } from 'source-map-js'
import { advancePositionWithMutation, CodegenContext, CodegenOptions, CodegenSourceMapGenerator, helperNameMap, isSimpleIdentifier, locStub, NodeTypes, Position, RootNode,  } from "@vue/compiler-core"

const enum NewlineType {
  Start = 0,
  End = -1,
  None = -2,
  Unknown = -3,
}


export function createCodegenContext(
  ast: RootNode,
  {
    mode = 'function',
    prefixIdentifiers = mode === 'module',
    sourceMap = false,
    filename = `template.vue.html`,
    scopeId = null,
    optimizeImports = false,
    runtimeGlobalName = `Vue`,
    runtimeModuleName = `vue`,
    ssrRuntimeModuleName = 'vue/server-renderer',
    ssr = false,
    isTS = false,
    inSSR = false,
  }: CodegenOptions,
): CodegenContext {
  const context: CodegenContext = {
    mode,
    prefixIdentifiers,
    sourceMap,
    filename,
    scopeId,
    optimizeImports,
    runtimeGlobalName,
    runtimeModuleName,
    ssrRuntimeModuleName,
    ssr,
    isTS,
    inSSR,
    source: ast.source,
    code: ``,
    column: 1,
    line: 1,
    offset: 0,
    indentLevel: 0,
    pure: false,
    map: undefined,
    helper(key) {
      return `_${helperNameMap[key]}`
    },
    push(code, newlineIndex = NewlineType.None, node) {
      context.code += code
      if (context.map) {
        if (node) {
          let name
          if (node.type === NodeTypes.SIMPLE_EXPRESSION && !node.isStatic) {
            const content = node.content.replace(/^_ctx\./, '')
            if (content !== node.content && isSimpleIdentifier(content)) {
              name = content
            }
          }
          if (node.loc.source) {
            addMapping(node.loc.start, name)
          }
        }
        if (newlineIndex === NewlineType.Unknown) {
          // multiple newlines, full iteration
          advancePositionWithMutation(context, code)
        } else {
          // fast paths
          context.offset += code.length
          if (newlineIndex === NewlineType.None) {
            
            context.column += code.length
          } else {
            // single newline at known index
            if (newlineIndex === NewlineType.End) {
              newlineIndex = code.length - 1
            }
            
            context.line++
            context.column = code.length - newlineIndex
          }
        }
        if (node && node.loc !== locStub && node.loc.source) {
          addMapping(node.loc.end)
        }
      }
    },
    indent() {
      newline(++context.indentLevel)
    },
    deindent(withoutNewLine = false) {
      if (withoutNewLine) {
        --context.indentLevel
      } else {
        newline(--context.indentLevel)
      }
    },
    newline() {
      newline(context.indentLevel)
    },
  }

  function newline(n: number) {
    context.push('\n' + `  `.repeat(n), NewlineType.Start)
  }

  function addMapping(loc: Position, name: string | null = null) {
    // we use the private property to directly add the mapping
    // because the addMapping() implementation in source-map-js has a bunch of
    // unnecessary arg and validation checks that are pure overhead in our case.
    const { _names, _mappings } = context.map!
    if (name !== null && !_names.has(name)) _names.add(name)
    _mappings.add({
      originalLine: loc.line,
      originalColumn: loc.column - 1, // source-map column is 0 based
      generatedLine: context.line,
      generatedColumn: context.column - 1,
      source: filename,
      name,
    })
  }

  if (sourceMap) {
    // lazy require source-map implementation, only in non-browser builds
    context.map =
      new SourceMapGenerator() as unknown as CodegenSourceMapGenerator
    context.map.setSourceContent(filename, context.source)
    context.map._sources.add(filename)
  }

  return context
}
