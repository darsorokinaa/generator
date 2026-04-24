import API from './api';
import { generatorPublicBaseUrl } from './generatorVariantUrl';

function apiOriginFromEnv() {
  const raw = (process.env.REACT_APP_API_URL || '').trim();
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

/** Публичный origin ЛК (если задан) — те же ссылки ДЗ не должны открываться на нём как на генераторе. */
function cabinetOriginsFromEnv() {
  const out = new Set();
  const apiO = apiOriginFromEnv();
  if (apiO) out.add(apiO);
  const raw = (process.env.REACT_APP_CABINET_ORIGIN || '').trim().replace(/\/$/, '');
  if (raw) {
    try {
      const base = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
      out.add(new URL(base).origin);
    } catch {
      /* empty */
    }
  }
  ['http://localhost:8001', 'http://127.0.0.1:8001'].forEach((x) => {
    try {
      out.add(new URL(x).origin);
    } catch {
      /* empty */
    }
  });
  return out;
}

/** Путь вида /app/lesson/… при ошибочном GENUROK — на генераторе нужен /lesson/… */
function stripAppPrefixFromPath(pathname) {
  const p = pathname || '';
  if (p === '/app' || p.startsWith('/app/')) {
    const rest = p.slice(4) || '/';
    return rest.startsWith('/') ? rest : `/${rest}`;
  }
  return p;
}

function looksLikeHomeworkOrVariantUrl(pathname, search) {
  const p = pathname || '';
  const s = search || '';
  if (p.includes('/lesson/join') || p.startsWith('/lesson/join')) return true;
  if (/(^|[?&])cabinet_session=homework(&|$)/.test(s) && /(^|[?&])token=/.test(s)) return true;
  return /\/(ege|oge|basic|prof|spec|[a-z0-9_-]+)\/[^/]+\/variant\/\d+/i.test(p);
}

function isCabinetLikeOrigin(u) {
  if (!u || !u.hostname) return false;
  if (cabinetOriginsFromEnv().has(u.origin)) return true;
  const h = (u.hostname || '').toLowerCase();
  if (h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' || h === '::1') {
    return u.port === 8001;
  }
  return false;
}

/**
 * Django часто отдаёт join/exam с GENUROK_URL=http://localhost:8001 (тот же хост, что Cabinet).
 * Тогда /lesson/join/ нет в urls.py → отдаётся SPA → редирект на /app/.
 * Подменяем origin на REACT_APP_GENERATOR_URL (см. generatorVariantUrl.js).
 */
function fixGeneratorNavUrl(targetUrl) {
  if (!targetUrl || typeof targetUrl !== 'string') return targetUrl;
  const genBase = generatorPublicBaseUrl();
  if (!/^https?:\/\//i.test(genBase)) return targetUrl;
  let genOrigin;
  try {
    genOrigin = new URL(genBase).origin;
  } catch {
    return targetUrl;
  }

  let raw = targetUrl.trim();
  if (!raw) return targetUrl;

  if (raw.startsWith('/') && !raw.startsWith('//')) {
    try {
      const rel = new URL(raw, genOrigin);
      if (looksLikeHomeworkOrVariantUrl(rel.pathname, rel.search)) {
        return rel.toString();
      }
    } catch {
      /* fall through */
    }
  }

  let u;
  try {
    u = new URL(raw);
  } catch {
    return targetUrl;
  }

  if (u.origin === genOrigin) return raw;

  const pathRaw = u.pathname || '';
  const path = stripAppPrefixFromPath(pathRaw);
  const search = u.search || '';
  const hash = u.hash || '';

  if (!looksLikeHomeworkOrVariantUrl(pathRaw, search) && !looksLikeHomeworkOrVariantUrl(path, search)) {
    return targetUrl;
  }

  if (!isCabinetLikeOrigin(u)) return targetUrl;

  return `${genOrigin}${path}${search}${hash}`;
}

/** Внешний helper: нормализует ссылку в сторону генератора (включая /lesson/join/). */
export function normalizeGeneratorNavUrl(targetUrl) {
  return fixGeneratorNavUrl(targetUrl);
}

/** Абсолютный http(s) URL и не тот же origin, что у страницы ЛК — иначе /ege/... откроется как маршрут CRA → дашборд. */
function isSafeExternalGeneratorUrl(u) {
  if (!u || typeof u !== 'string') return false;
  const s = u.trim();
  if (!/^https?:\/\//i.test(s)) return false;
  if (typeof window === 'undefined') return true;
  try {
    return new URL(s).origin !== window.location.origin;
  } catch {
    return false;
  }
}

/**
 * Ссылка на комнату ДЗ на генераторе (как урок). Без промежуточной страницы ЛК ?homework_room=.
 */
export async function fetchHomeworkGeneratorJoinUrl(assignmentId) {
  const id = String(assignmentId || '').trim();
  if (!id) throw new Error('Не указано назначение ДЗ');
  const res = await fetch(
    `${API}/api/homework/assignment/${encodeURIComponent(id)}/join-url/?role=auto`,
    { credentials: 'include' },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = typeof data.error === 'string' ? data.error : `Ошибка ${res.status}`;
    throw new Error(msg);
  }
  const join =
    (typeof data.url === 'string' && data.url.trim())
    || (typeof data.student_url === 'string' && data.student_url.trim())
    || (typeof data.teacher_url === 'string' && data.teacher_url.trim());
  const exam = typeof data.exam_url === 'string' ? data.exam_url.trim() : '';
  const joinFixed = fixGeneratorNavUrl(join);
  const examFixed = exam ? fixGeneratorNavUrl(exam) : '';
  // Раньше: при ЛК на том же origin, что и ошибочный exam (например :8001), exam отбрасывался —
  // оставалась «сырая» ссылка без подмены на генератор. Сначала чиним origin, потом выбираем.
  const preferExam = examFixed && /\/variant\/\d+/i.test(examFixed);
  let url = preferExam ? examFixed : (joinFixed || examFixed);
  if (!url) {
    const raw = (isSafeExternalGeneratorUrl(exam) ? exam : '') || join;
    url = fixGeneratorNavUrl(raw);
  }
  if (!url) throw new Error('Нет ссылки на комнату');
  return { url, data };
}

export function navigateToHomeworkRoomUrl(target, { newTab = false } = {}) {
  if (!target) return;
  const url = normalizeGeneratorNavUrl(target);
  if (newTab) window.open(url, '_blank', 'noopener,noreferrer');
  else window.location.replace(url);
}

/** Один переход в комнату на генераторе (та же вкладка по умолчанию). */
export async function openHomeworkOnGenerator(assignmentId, { newTab = false } = {}) {
  const { url } = await fetchHomeworkGeneratorJoinUrl(assignmentId);
  navigateToHomeworkRoomUrl(url, { newTab });
}

/**
 * Базовый путь SPA ЛК.
 * Нужен, чтобы проверка ДЗ открывалась как отдельная «страница плеера», а не
 * `...?page=homework&variant_play=...` с лишними query от дашборда.
 */
export function cabinetSpaBasePathname() {
  return '/';
}

/**
 * Origin SPA, где открывается VariantPlayPage (полноэкранное ДЗ / проверка).
 * Всегда используем текущий origin страницы, чтобы не было лишних редиректов между 8001/3000.
 */
export function cabinetSpaPlayerOrigin() {
  if (typeof window === 'undefined') return '';
  return window.location.origin;
}

/**
 * Проверка ДЗ учителем — только в SPA ЛК (?variant_play= + hw_review=1), без join-url на генератор.
 * Иначе до прихода /api/me/ с ролью срабатывает редирект ученика → :8001/app/.
 */
export function buildHomeworkReviewPlayUrl(assignmentId) {
  if (typeof window === 'undefined' || assignmentId == null || assignmentId === '') return '';
  const u = new URL(cabinetSpaBasePathname(), cabinetSpaPlayerOrigin());
  u.searchParams.set('variant_play', String(assignmentId));
  u.searchParams.set('hw_review', '1');
  u.searchParams.delete('homework_room');
  ['hw_local', 'lesson_token', 'lesson_room_id', 'lesson_target', 'lesson_variant_id', 'page'].forEach((k) => {
    u.searchParams.delete(k);
  });
  return u.toString();
}
