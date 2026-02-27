import { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";

function SearchVariantPage() {
  const location = useLocation();
  const q = new URLSearchParams(location.search).get("q")?.trim() ?? "";

  const [data, setData] = useState({ variant: null, tasks: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!q) {
      setData({ variant: null, tasks: [] });
      return;
    }
    setLoading(true);
    setError(null);
    const origin = typeof window !== "undefined" && window.location.origin;
    const apiBase = origin && origin.includes(":5000") ? "http://localhost:8000" : "";
    fetch(`${apiBase}/api/search_variant/?q=${encodeURIComponent(q)}`, { credentials: "include" })
      .then((res) => {
        if (!res.ok) throw new Error(res.statusText);
        return res.json();
      })
      .then((d) => {
        setData({ variant: d.variant || null, tasks: d.tasks || [] });
      })
      .catch((err) => {
        setError(err.message);
        setData({ variant: null, tasks: [] });
      })
      .finally(() => setLoading(false));
  }, [q]);

  useEffect(() => {
    if (data.tasks.length > 0 && window.MathJax) {
      setTimeout(() => {
        try {
          if (window.MathJax.typesetClear) window.MathJax.typesetClear();
          if (window.MathJax.typesetPromise) window.MathJax.typesetPromise();
        } catch (err) {
          console.error("MathJax error:", err);
        }
      }, 100);
    }
  }, [data]);

  if (!q) {
    return (
      <div className="container search-variant-page">
        <div className="search-task-hero">
          <h1>Поиск варианта</h1>
          <p>Введите ID варианта в форме поиска на странице выбора предмета (ОГЭ или ЕГЭ).</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container search-variant-page">
      <div className="search-task-hero">
        <h1>Поиск варианта: ID {q}</h1>
        <p>Результат поиска</p>
      </div>

      {loading && (
        <div className="search-task-loading">
          <div className="search-task-spinner" />
          <p>Загрузка...</p>
        </div>
      )}

      {!loading && error && (
        <div className="search-task-empty-card">
          <span className="search-task-empty-icon">⚠️</span>
          <h3>Ошибка</h3>
          <p>{error}</p>
        </div>
      )}

      {!loading && !error && (!data.variant || data.tasks.length === 0) && (
        <div className="search-task-empty-card">
          <span className="search-task-empty-icon">🔍</span>
          <h3>Ничего не найдено</h3>
          <p>Вариант с ID {q} не найден.</p>
        </div>
      )}

      {!loading && !error && data.tasks.length > 0 && (
        <table className="search-variant-table">
          <thead>
            <tr>
              <th>ID задачи</th>
              <th>Номер задания</th>
              <th>Ответ</th>
            </tr>
          </thead>
          <tbody>
            {data.tasks.map((t) => (
              <tr key={t.number}>
                <td className="search-variant-id">{t.id}</td>
                <td>{t.number}</td>
                <td>{t.answer}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default SearchVariantPage;
