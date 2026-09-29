// Плейн-текст из lexical-контента — для meta description и выжимок.
// Вынесено из PostView (SEO #051), чтобы тем же пользовались description
// статических страниц (D-088, замечание Вебмастера 29.09: дубли description).
export function extractText(content: unknown, max = 200): string {
  const parts: string[] = []
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    const n = node as { text?: unknown; children?: unknown[] }
    if (typeof n.text === 'string') parts.push(n.text)
    if (Array.isArray(n.children)) n.children.forEach(walk)
  }
  walk((content as { root?: unknown } | null | undefined)?.root)
  const text = parts.join(' ').replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}
