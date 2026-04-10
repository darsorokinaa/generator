/**
 * Единая база REST API. Пути не собираются из pathname страницы (никаких /lesson/join внутри /api/...).
 *
 * - По умолчанию: относительный префикс `/api` на том же origin.
 * - VITE_API_BASE: полный URL вида `https://genurok.tw1.ru` или `https://genurok.tw1.ru/api` (другой host/path в production).
 * - В dev (Vite :5000 / :5173) без VITE_API_BASE: тот же механизм, что devApiBase — запросы на Django :8000.
 */
import { devApiBase } from "../utils/devApiBase";

export function getApiRoot() {
  const explicit = import.meta.env.VITE_API_BASE;
  if (explicit != null && String(explicit).trim() !== "") {
    let b = String(explicit).trim().replace(/\/+$/, "");
    if (/^https?:\/\//i.test(b)) {
      return b.endsWith("/api") ? b : `${b}/api`;
    }
    if (b === "/api" || b === "api") return "/api";
    return b.startsWith("/") ? `${b.replace(/\/$/, "")}/api`.replace(/\/+/g, "/") : "/api";
  }
  const d = devApiBase();
  if (d) return `${d.replace(/\/$/, "")}/api`;
  return "/api";
}

/**
 * @param {string} pathAfterApi путь после /api/, например `ege/math/tasks/` или `announcements/`
 * @returns {string} полный URL (относительный или абсолютный)
 */
export function apiUrl(pathAfterApi) {
  let p = String(pathAfterApi ?? "").trim();
  if (p.startsWith("/api/")) p = p.slice(5);
  else if (p.startsWith("api/")) p = p.slice(4);
  p = p.replace(/^\/+/, "");
  const root = getApiRoot();
  if (!p) return root;
  return `${root}/${p}`.replace(/([^:]\/)\/+/g, "$1");
}

/** Учётные данные для fetch: в dev на другой origin — omit; иначе include. */
export function apiFetchCredentials() {
  if (typeof window === "undefined") return "same-origin";
  const root = getApiRoot();
  if (/^https?:\/\//i.test(root)) {
    if (root.startsWith(window.location.origin)) return "include";
    return "omit";
  }
  return "include";
}

/**
 * Маршрут /:level/:subject совпал с «lesson»/«join» (страница урока не должна грузить тренажёр).
 */
export function isLessonJoinTrainerSegments(level, subject) {
  return (
    String(level || "").toLowerCase() === "lesson" &&
    String(subject || "").toLowerCase() === "join"
  );
}

/**
 * URL вида /api/<level>/<subject>/... для тренажёра и экзамена. Для lesson/join — null (не вызывать fetch).
 */
export function trainerSubjectApiUrl(level, subject, suffix) {
  if (isLessonJoinTrainerSegments(level, subject)) return null;
  const a = String(level ?? "").trim();
  const b = String(subject ?? "").trim();
  if (!a || !b) return null;
  const tail = String(suffix ?? "").replace(/^\/+/, "");
  return apiUrl(`${a}/${b}/${tail}`);
}
