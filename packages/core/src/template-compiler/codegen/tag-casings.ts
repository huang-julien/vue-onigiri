/**
 * All casing variants a template tag can resolve under
 * PascalCase, camelCase, and kebab-case
 */
export function tagCasings(tag: string): string[] {
  const pascal = tag
    .replace(/-./g, (x) => x[1]?.toUpperCase() ?? "")
    .replace(/^./, (x) => x.toUpperCase());
  const camel = pascal.replace(/^./, (x) => x.toLowerCase());
  const kebab = tag.replace(/([a-z\d])([A-Z])/g, "$1-$2").toLowerCase();
  return [tag, pascal, camel, kebab];
}
