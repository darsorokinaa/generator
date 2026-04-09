/**
 * Запасной URL ЛК до ответа `/api/site-config/` (Django `LK_PUBLIC_URL`).
 * Локально: можно задать VITE_LK_URL в .env — не ставьте URL главной генератора.
 */
export const LK_PUBLIC_URL = String(import.meta.env.VITE_LK_URL || "https://lk.genurok.tw1.ru").replace(
  /\/$/,
  ""
);
