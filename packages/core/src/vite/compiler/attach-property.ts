import MagicString from "magic-string";

/**
 * Dev mode: import the per-SFC virtual `__onigiriRender` and attach it
 * as a property on the SFC's default export. Handles every shape
 * `@vitejs/plugin-vue` emits: `_export_sfc(_sfc_main, …)`, plain
 * `export default _sfc_main`, and inline `_defineComponent({…})`.
 */
export function attachAsProperty(
  code: string,
  resolvedOnigiriId: string,
  sourceMap: boolean,
): { code: string; map: any } | null {
  if (!code.includes("export default")) return null;

  const s = new MagicString(code);
  const importStatement = `import __onigiriRender from "${resolvedOnigiriId}";\n`;

  const exportSfcMatch = code.match(
    /export\s+default\s+(?:\/\*[^*]*\*\/\s*)?_export_sfc\s*\(\s*(_sfc_main|_sfc_component)/,
  );
  if (exportSfcMatch && exportSfcMatch[1] && exportSfcMatch.index !== undefined) {
    s.prepend(importStatement);
    s.appendLeft(exportSfcMatch.index, `${exportSfcMatch[1]}.__onigiriRender = __onigiriRender;\n`);
    return { code: s.toString(), map: sourceMap ? s.generateMap({ hires: true }) : null };
  }

  const varExportMatch = code.match(
    /export\s+default\s+(_sfc_main|__default__|_sfc_component)\s*;?\s*$/m,
  );
  if (varExportMatch && varExportMatch[1] && varExportMatch.index !== undefined) {
    s.prepend(importStatement);
    s.appendLeft(varExportMatch.index, `${varExportMatch[1]}.__onigiriRender = __onigiriRender;\n`);
    return { code: s.toString(), map: sourceMap ? s.generateMap({ hires: true }) : null };
  }

  const inlineExportMatch = code.match(/export\s+default\s+(?:\/\*[^*]*\*\/\s*)?/);
  if (inlineExportMatch && inlineExportMatch.index !== undefined) {
    s.prepend(importStatement);
    s.overwrite(
      inlineExportMatch.index,
      inlineExportMatch.index + inlineExportMatch[0].length,
      "const __sfc_with_onigiri = ",
    );
    s.append(
      `\n__sfc_with_onigiri.__onigiriRender = __onigiriRender;\nexport default __sfc_with_onigiri;`,
    );
    return { code: s.toString(), map: sourceMap ? s.generateMap({ hires: true }) : null };
  }

  return null;
}
