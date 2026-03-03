import { useEffect, useRef } from "react";

/**
 * Рендерит HTML с поддержкой LaTeX/MathJax. На любой странице MathJax
 * корректно отображает формулы.
 */
export function MathContent({ html, className }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current) return;
    ref.current.innerHTML = (html != null ? String(html) : "") || "";
    const el = ref.current;

    const run = () => {
      if (window.MathJax?.typesetPromise) {
        window.MathJax.typesetPromise([el]).catch(() => {});
      } else {
        const id = setTimeout(run, 100);
        return () => clearTimeout(id);
      }
    };
    run();
  }, [html]);

  return <div ref={ref} className={className} />;
}

export default MathContent;
