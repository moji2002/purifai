export type TagKind =
  | 'void'
  | 'inline'
  | 'block'
  | 'list'
  | 'table'
  | 'pre'
  | 'raw-preserve'
  | 'raw-drop'
  | 'ordinary-drop'
  | 'head'
  | 'foreign-drop';

export type SemanticTag =
  | 'a' | 'abbr' | 'address' | 'article' | 'aside' | 'audio'
  | 'b' | 'bdi' | 'bdo' | 'blockquote' | 'body' | 'br' | 'button'
  | 'canvas' | 'caption' | 'cite' | 'code' | 'col' | 'colgroup'
  | 'data' | 'dd' | 'del' | 'details' | 'dfn' | 'dialog' | 'div' | 'dl' | 'dt'
  | 'em' | 'fieldset' | 'figcaption' | 'figure' | 'footer' | 'form'
  | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'head' | 'header' | 'hgroup' | 'hr' | 'html'
  | 'i' | 'img' | 'input' | 'ins' | 'kbd' | 'label' | 'legend' | 'li'
  | 'main' | 'mark' | 'menu' | 'nav' | 'object' | 'ol' | 'option'
  | 'p' | 'pre' | 'q' | 'rp' | 'rt' | 'ruby' | 's' | 'samp' | 'section'
  | 'select' | 'slot' | 'small' | 'span' | 'strong' | 'sub' | 'summary' | 'sup'
  | 'table' | 'tbody' | 'td' | 'textarea' | 'tfoot' | 'th' | 'thead' | 'time' | 'tr'
  | 'u' | 'ul' | 'var' | 'video' | 'wbr' | 'xmp' | 'plaintext'
  | DroppedTag;

export type DroppedTag =
  | 'applet' | 'base' | 'embed' | 'frameset' | 'iframe' | 'link' | 'math'
  | 'meta' | 'noembed' | 'noframes' | 'noscript' | 'param' | 'script'
  | 'source' | 'style' | 'svg' | 'template' | 'title' | 'track';

export interface SelectedAttributes {
  href?: string;
  alt?: string;
  start?: string;
  value?: string;
}

export interface TagPolicy {
  readonly name: SemanticTag;
  readonly kind: TagKind;
}

const POLICIES: Record<string, TagPolicy | undefined> = Object.create(null) as Record<string, TagPolicy | undefined>;

function register(kind: TagKind, names: readonly SemanticTag[]): void {
  for (const name of names) POLICIES[name] = Object.freeze({ name, kind });
}

register('void', [
  'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param',
  'source', 'track', 'wbr',
]);
register('inline', [
  'a', 'abbr', 'b', 'bdi', 'bdo', 'button', 'cite', 'code', 'data', 'del',
  'dfn', 'em', 'html', 'body', 'i', 'ins', 'kbd', 'label', 'legend', 'mark',
  'object', 'option', 'q', 'rp', 'rt', 'ruby', 's', 'samp', 'select', 'slot',
  'small', 'span', 'strong', 'sub', 'sup', 'time', 'u', 'var', 'audio',
  'canvas', 'video',
]);
register('block', [
  'address', 'article', 'aside', 'blockquote', 'details', 'dialog', 'div',
  'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3',
  'h4', 'h5', 'h6', 'header', 'hgroup', 'main', 'nav', 'p', 'section',
  'summary', 'dd', 'dt', 'legend',
]);
register('list', ['dl', 'li', 'menu', 'ol', 'ul']);
register('table', ['caption', 'colgroup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr']);
register('pre', ['pre']);
register('raw-preserve', ['plaintext', 'textarea', 'xmp']);
register('raw-drop', [
  'iframe', 'noembed', 'noframes', 'noscript', 'script', 'style', 'title',
]);
register('ordinary-drop', [
  'applet', 'frameset', 'template',
]);
register('head', ['head']);
register('foreign-drop', ['math', 'svg']);

export function getTagPolicy(name: string): TagPolicy | null {
  return POLICIES[name] ?? null;
}

export function createsBlockBoundary(tag: SemanticTag): boolean {
  const kind = POLICIES[tag]?.kind;
  return kind === 'block' || kind === 'list' || kind === 'table' || kind === 'pre' || kind === 'raw-preserve';
}
