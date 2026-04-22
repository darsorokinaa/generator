const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function (app) {
  const lkTarget = process.env.REACT_APP_LK_PROXY_TARGET || 'http://localhost:8001';
  const lkRoutes = ['/login', '/logout', '/register', '/settings', '/admin'];

  // API → LK Django
  app.use(
    '/api',
    createProxyMiddleware({
      target: lkTarget,
      changeOrigin: true,
    })
  );

  // Auth/pages → LK Django (чтобы редиректы на /login/ в dev не уходили в другой сервис)
  app.use(
    lkRoutes,
    createProxyMiddleware({
      target: lkTarget,
      changeOrigin: true,
    })
  );

  // WebSocket → LK Django
  app.use(
    '/ws',
    createProxyMiddleware({
      target: lkTarget,
      changeOrigin: true,
      ws: true,
      logLevel: 'warn',
      onError: (err) => {
        console.error('[proxy /ws] error:', err.message);
      },
    })
  );
};
