import { useMemo } from 'react';
import { sanitize } from 'purifai';

export function UserComment({ comment }) {
  const plainText = useMemo(() => sanitize(comment.html), [comment.html]);

  // React text interpolation performs output escaping. Purifai has already
  // reduced the source markup to reader text; no HTML injection sink is needed.
  return (
    <article>
      <h2>{comment.author}</h2>
      <p>{plainText}</p>
    </article>
  );
}

// If safe formatting must survive, use a maintained allow-list sanitizer such
// as DOMPurify. Purifai's sanitize() contract is plain text only. The
// escapeAttribute()/escapeUrl() APIs target serialized HTML; do not double-
// encode their output through React's JSX escaping.
