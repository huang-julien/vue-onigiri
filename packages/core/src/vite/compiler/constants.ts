export const ONIGIRI_QUERY = "?vue&type=onigiri&lang.mjs";

export function toOnigiriId(filePath: string): string {
  return filePath + ONIGIRI_QUERY;
}

export function parseOnigiriId(id: string): string | undefined {
  return id.endsWith(ONIGIRI_QUERY) ? id.slice(0, -ONIGIRI_QUERY.length) : undefined;
}
