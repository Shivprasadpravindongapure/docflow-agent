import express from 'express';

export function createApp() {
  const app = express();

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'agent' });
  });

  return app;
}

const app = createApp();
const port = Number(process.env.PORT) || 4100;

if (process.env.NODE_ENV !== 'test') {
  app.listen(port, () => {
    console.log(`Agent server running on http://localhost:${port}`);
  });
}

export default app;
