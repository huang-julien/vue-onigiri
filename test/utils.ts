

export function removeCommentsFromHtml(html: string) { 
    return html.replace(/<!--[\s\S]*?-->/g, '')
}