/**
 * Публичный URL страницы варианта на сайте генератора (как /ege/math/variant/5/).
 */
import API from './api';

const GEN_RAW = (process.env.REACT_APP_GENERATOR_URL || 'https://test.genurok.ru').replace(/\/$/, '');

export function generatorPublicBaseUrl() {
  return GEN_RAW.replace(/\/api$/, '');
}

/**
 * Публичная страница варианта (кнопка «Предпросмотр»): основной домен, а не API/test.
 * REACT_APP_VARIANT_PREVIEW_ORIGIN — при необходимости https://genurok.ru и т.п.
 * По умолчанию — https://генурок.рф
 */
export function variantPreviewSiteBaseUrl() {
  const raw = (process.env.REACT_APP_VARIANT_PREVIEW_ORIGIN || '').trim().replace(/\/$/, '');
  if (raw) {
    return raw.replace(/\/api$/, '');
  }
  return 'https://генурок.рф';
}

export async function fetchGeneratorVariantMeta(variantId) {
  const vid = Number(variantId);
  if (!Number.isFinite(vid) || vid <= 0) throw new Error('Некорректный вариант');
  const r = await fetch(`${API}/api/gen/variant-lookup/${vid}/`, { credentials: 'include' });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${r.status}`);
  }
  return data;
}

export function buildGeneratorVariantPageUrl(level, subject, variantId, extraParams = {}) {
  const base = generatorPublicBaseUrl();
  const lv = String(level || '').toLowerCase().replace(/^\/+|\/+$/g, '');
  const sj = String(subject || '').toLowerCase().replace(/^\/+|\/+$/g, '');
  const id = String(variantId).replace(/^\/+|\/+$/g, '');
  const u = new URL(`${base}/${lv}/${sj}/variant/${id}/`);
  Object.entries(extraParams).forEach(([k, v]) => {
    if (v != null && v !== '') u.searchParams.set(k, String(v));
  });
  return u.toString();
}

/** Полноценная страница варианта на генераторе (текущая вкладка). */
export async function navigateToGeneratorVariantExam({ variantId, assignmentId }) {
  const meta = await fetchGeneratorVariantMeta(variantId);
  const url = buildGeneratorVariantPageUrl(meta.level, meta.subject, variantId, {
    cabinet_assignment: assignmentId,
  });
  window.location.assign(url);
}
