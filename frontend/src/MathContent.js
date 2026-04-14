import { useEffect, useRef } from 'react';
import { ensureMathJax } from './mathJaxUtils';

/**
 * Как в проекте «01 generator»: HTML задаётся в useEffect, затем MathJax typeset.
 * Так React не затирает отрендеренные формулы при следующих ререндерах
 * (в отличие от dangerouslySetInnerHTML в render).
 */
export function MathContent({ html, className, style, onImageClick }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current) return;
    ref.current.innerHTML = html != null ? String(html) : '';
    const el = ref.current;
    ensureMathJax();

    let cancelled = false;
    let timeoutId;
    const run = () => {
      if (cancelled) return;
      if (window.MathJax?.typesetPromise) {
        window.MathJax.typesetPromise([el]).catch(() => {});
      } else {
        timeoutId = setTimeout(run, 80);
      }
    };
    run();
    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [html]);

  useEffect(() => {
    if (!onImageClick || !ref.current) return;
    const el = ref.current;
    const imgs = el.querySelectorAll('img');
    const handlers = [];
    imgs.forEach((img) => {
      if (img.closest('.task-img-zoomable')) return;
      const wrap = document.createElement('span');
      wrap.className = 'task-img-zoomable';
      img.parentNode?.insertBefore(wrap, img);
      wrap.appendChild(img);
      const hint = document.createElement('span');
      hint.className = 'task-img-zoom-hint';
      hint.setAttribute('aria-hidden', 'true');
      hint.setAttribute('role', 'presentation');
      hint.setAttribute('title', 'Увеличить');
      hint.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>';
      wrap.appendChild(hint);
      const openLightbox = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const targetImg = wrap.querySelector('img');
        if (targetImg) onImageClick(targetImg.src || targetImg.getAttribute('src'));
      };
      wrap.addEventListener('click', openLightbox);
      hint.addEventListener('click', openLightbox);
      handlers.push({ wrap, handler: openLightbox });
    });
    return () =>
      handlers.forEach(({ wrap, handler }) => {
        wrap.removeEventListener('click', handler);
      });
  }, [html, onImageClick]);

  return <div ref={ref} className={className} style={style} />;
}

export default MathContent;
