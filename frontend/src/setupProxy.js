const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function (app) {
  // API → LK Django
  app.use(
    '/api',
    createProxyMiddleware({
      target: 'http://localhost:8001',
      changeOrigin: true,
    })
  );

  // WebSocket signaling → LK Django (Daphne ASGI)
  app.use(
    '/ws',
    createProxyMiddleware({
      target: 'http://localhost:8001',
      changeOrigin: true,
      ws: true,
      logLevel: 'warn',
      onError: (err, req, res) => {
        console.error('[proxy /ws] error:', err.message);
      },
    })
  );
};
