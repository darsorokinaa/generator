/**
 * Общая загрузка MathJax 3 и typeset для DOM-узла (LaTeX в HTML).
 */

import { useEffect, useRef } from 'react';

let mathJaxInjected = false;

/** Конфигурация как в «01 generator» (frontend/index.html + lesson_room skipHtmlTags). */
export function ensureMathJax() {
  if (document.getElementById('mathjax-script')) return;
  if (mathJaxInjected) return;
  mathJaxInjected = true;
  window.MathJax = {
    tex: {
      inlineMath: [['$', '$'], ['\\(', '\\)']],
      displayMath: [['$$', '$$'], ['\\[', '\\]']],
    },
    chtml: {
      scale: 1.525,
      mtextInheritFont: true,
      matchFontHeight: false,
    },
    options: {
      skipHtmlTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'],
    },
    startup: { typeset: false },
  };
  const s = document.createElement('script');
  s.id = 'mathjax-script';
  s.src = 'https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js';
  s.async = true;
  document.head.appendChild(s);
}

export function typesetContainer(el) {
  if (!el) return;
  const run = () => {
    if (!window.MathJax?.typesetPromise) return;
    window.MathJax.typesetPromise([el]).catch(() => {});
  };
  if (window.MathJax?.startup?.promise) {
    window.MathJax.startup.promise.then(run).catch(run);
  } else {
    run();
    let n = 0;
    const id = setInterval(() => {
      n += 1;
      if (window.MathJax?.startup?.promise) {
        clearInterval(id);
        window.MathJax.startup.promise.then(run).catch(run);
      } else if (n > 200) clearInterval(id);
    }, 50);
  }
}

export function escapeHtmlText(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** HTML или текст с формулами — innerHTML в эффекте + MathJax (как MathContent в 01). */
export function MathHtmlBlock({ html, style, className }) {
  const ref = useRef(null);
  const raw = html == null ? '' : String(html);
  const looksLikeHtml = /<\s*[a-z]/i.test(raw);
  const inner = looksLikeHtml ? raw : escapeHtmlText(raw);

  useEffect(() => {
    if (!ref.current) return;
    if (!inner) {
      ref.current.innerHTML = '';
      return;
    }
    ref.current.innerHTML = inner;
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
  }, [inner]);

  if (!raw) return null;

  const baseStyle = {
    fontSize: 13,
    color: '#374151',
    lineHeight: 1.65,
    wordBreak: 'break-word',
    ...(looksLikeHtml ? {} : { whiteSpace: 'pre-wrap' }),
    ...style,
  };

  return <div ref={ref} className={className} style={baseStyle} />;
}
