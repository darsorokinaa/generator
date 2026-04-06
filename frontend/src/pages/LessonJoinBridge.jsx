import { useLayoutEffect } from "react";

/**
 * Ссылка из ЛК ведёт на /lesson/join?token=...
 * Если в ответ пришёл index.html SPA, React Router раньше матчил /:level/:subject → level=lesson, subject=join
 * и показывал TasksPage с заголовком «join» и ошибкой API.
 * Здесь: нормализуем слэш под Django и один раз перезагружаем документ — если nginx проксирует /lesson/ на Django, откроется lesson_room.html.
 */
export default function LessonJoinBridge() {
  useLayoutEffect(() => {
    const url = new URL(window.location.href);
    if (url.pathname === "/lesson/join") {
      url.pathname = "/lesson/join/";
      window.location.replace(url.toString());
      return;
    }
    const k = "lesson_join_full_reload_once";
    if (!sessionStorage.getItem(k)) {
      sessionStorage.setItem(k, "1");
      window.location.reload();
    }
  }, []);

  return (
    <div className="app-shell-content" style={{ padding: "2rem", maxWidth: 560 }}>
      <h1 style={{ fontSize: "1.35rem", marginBottom: "0.75rem" }}>Вход в урок</h1>
      <p style={{ marginBottom: "1rem", lineHeight: 1.5 }}>
        Страница урока должна отдаваться Django (<code>/lesson/join/</code>), а не этим интерфейсом. Если вы снова видите этот текст после
        обновления, на сервере не проксируется префикс <code>/lesson/</code> на бэкенд (см. <code>deploy/nginx.conf</code>).
      </p>
      <button
        type="button"
        className="add-button primary"
        style={{ cursor: "pointer" }}
        onClick={() => {
          sessionStorage.removeItem("lesson_join_full_reload_once");
          window.location.reload();
        }}
      >
        Обновить страницу
      </button>
    </div>
  );
}
