import { PurifaiLimitError, toText } from 'purifai';

/**
 * Express-style middleware that derives readable text from req.body.html.
 * It rejects oversized input instead of rewriting every request field.
 */
export function readableTextBody({ maxInput = 100_000, maxOutput = 25_000 } = {}) {
  return function convertHtmlBody(req, res, next) {
    const html = req.body?.html;
    if (typeof html !== 'string') {
      return res.status(400).json({ error: 'HTML_STRING_REQUIRED' });
    }

    try {
      req.body.text = toText(html, {
        limits: {
          input: maxInput,
          output: maxOutput,
          depth: 64,
          token: 65_536,
        },
      });
      return next();
    } catch (error) {
      if (!(error instanceof PurifaiLimitError)) return next(error);
      return res.status(413).json({
        error: `HTML_${error.kind.toUpperCase()}_LIMIT`,
        limit: error.limit,
        observed: error.observed,
      });
    }
  };
}
