/**
 * Общая загрузка MathJax 3 и typeset для DOM-узла (LaTeX в HTML).
 */

import { useEffect, useRef } from 'react';

let mathJaxInjected = false;

export function ensureMathJax() {
  if (document.getElementById('mathjax-script')) return;
  if (mathJaxInjected) return;
  mathJaxInjected = true;
  window.MathJax = {
    tex: { inlineMath: [['\\(', '\\)'], ['$', '$']], displayMath: [['\\[', '\\]'], ['$$', '$$']] },
    options: { skipHtmlTags: ['script', 'noscript', 'style', 'textarea', 'pre'] },
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

/** HTML или текст с формулами ($…$, \\(...\\)) — рендер и MathJax. */
export function MathHtmlBlock({ html, style, className }) {
  const ref = useRef(null);
  const raw = html == null ? '' : String(html);
  const looksLikeHtml = /<\s*[a-z]/i.test(raw);

  useEffect(() => {
    if (!ref.current || !raw) return;
    ensureMathJax();
    typesetContainer(ref.current);
    let cancelled = false;
    let id;
    if (!window.MathJax?.typesetPromise) {
      id = setInterval(() => {
        if (cancelled) return;
        if (window.MathJax?.typesetPromise) {
          clearInterval(id);
          typesetContainer(ref.current);
        }
      }, 80);
    }
    return () => {
      cancelled = true;
      if (id) clearInterval(id);
    };
  }, [raw]);

  if (!raw) return null;

  const baseStyle = {
    fontSize: 13,
    color: '#374151',
    lineHeight: 1.65,
    wordBreak: 'break-word',
    ...style,
  };

  if (looksLikeHtml) {
    return (
      <div
        ref={ref}
        className={className}
        style={baseStyle}
        dangerouslySetInnerHTML={{ __html: raw }}
      />
    );
  }

  return (
    <div ref={ref} className={className} style={{ ...baseStyle, whiteSpace: 'pre-wrap' }}>
      {raw}
    </div>
  );
}
