import { useMemo } from 'react';
import { toText } from 'purifai';

/**
 * React escapes text children. No raw-HTML escape hatch is needed here.
 */
export function ArticlePreview({ html }) {
  const text = useMemo(
    () => toText(html, {
      links: 'label-and-url',
      limits: { input: 200_000, output: 50_000 },
    }),
    [html],
  );

  return <pre className="article-preview">{text}</pre>;
}

/**
 * Convert plain string fields only when they are documented to contain HTML.
 */
export function Comment({ author, html }) {
  const text = useMemo(() => toText(html), [html]);

  return (
    <article>
      <strong>{author}</strong>
      <p>{text}</p>
    </article>
  );
}
