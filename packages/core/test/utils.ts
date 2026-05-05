export function removeCommentsFromHtml(html: string) {
  let previous: string;
  do {
    previous = html;
    html = html.replace(/<!--[\s\S]*?-->/g, "");
  } while (html !== previous);
  return html;
}
