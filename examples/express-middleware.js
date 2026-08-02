import express from 'express';
import { analyze } from 'purifai';

const app = express();
app.use(express.json());

app.post('/comments', (req, res) => {
  if (typeof req.body?.comment !== 'string') {
    return res.status(400).json({ error: 'comment must be a string' });
  }

  const result = analyze(req.body.comment, { maxLength: 10_000 });

  // The analysis fields are useful for telemetry, but they are heuristic and
  // must not replace authentication, authorization, schema validation, or rate
  // limiting. Store only the field whose product contract is plain text.
  console.info({
    markupWarning: result.hadThreats,
    threatLevel: result.threatLevel,
  });

  return res.status(201).json({
    comment: result.content,
  });
});

app.listen(3000);
