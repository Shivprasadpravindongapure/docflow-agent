import express from 'express';

const app = express();
const port = Number(process.env.PORT) || 4000;

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'api' });
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(port, () => {
    console.log(`API server running on http://localhost:${port}`);
  });
}

export default app;
