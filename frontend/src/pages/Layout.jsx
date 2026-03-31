import { useCallback, useEffect, useState } from "react";
import { Outlet, Link, useLocation } from "react-router-dom";

function readThemeData() {
  try {
    const raw = sessionStorage.getItem("theme_data");
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return null;
}

function Layout() {
  const { pathname } = useLocation();
  const [theme, setTheme] = useState(() =>
    typeof document !== "undefined" &&
    document.documentElement.getAttribute("data-theme") === "dark"
      ? "dark"
      : "light"
  );
  const [themeData, setThemeData] = useState(readThemeData);

  const syncTheme = useCallback(() => setThemeData(readThemeData()), []);

  useEffect(() => {
    window.addEventListener("theme-change", syncTheme);
    return () => window.removeEventListener("theme-change", syncTheme);
  }, [syncTheme]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("theme", theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  useEffect(() => {
    const run = () => {
      if (window.MathJax?.typesetPromise) {
        window.MathJax.typesetPromise().catch(() => {});
      } else {
        setTimeout(run, 100);
      }
    };
    const id = setTimeout(run, 100);
    return () => clearTimeout(id);
  }, [pathname]);
  return (
    <div className="app-shell">
      <div
        className="app-shell-pattern"
        aria-hidden="true"
        style={{
          backgroundImage: `url('${import.meta.env.BASE_URL}img/bg.png')`,
        }}
      />
      {themeData?.overlay && (
        <div
          className="app-shell-theme-overlay"
          aria-hidden="true"
          style={{ backgroundImage: `url(${themeData.overlay})` }}
        />
      )}
      {themeData?.decor && (
        <div
          className="app-shell-theme-decor"
          aria-hidden="true"
          style={{ backgroundImage: `url(${themeData.decor})` }}
        />
      )}
      <div className="app-shell-content">
      <header
        className={themeData?.headerBg ? "header--themed" : undefined}
        style={themeData?.headerBg ? { backgroundImage: `url(${themeData.headerBg})` } : undefined}
      >
      <div className="container">
    <div className="header-wrapper">
      <div className="logo-block">
        <Link to="/" className="logo-link">
          {themeData?.logo ? (
            <img className="logo-theme-icon" src={themeData.logo} alt="Генератор" />
          ) : (
            <span className="logo-icon-sum" aria-hidden="true">∑</span>
          )}
          <span className="logo-text">Генератор</span>
        </Link>
      </div>
      <nav className="header-nav">
        <button
          type="button"
          className="theme-toggle"
          onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
          aria-pressed={theme === "dark"}
          aria-label={
            theme === "dark"
              ? "Переключить на светлую тему"
              : "Переключить на тёмную тему"
          }
          title={
            theme === "dark" ? "Светлая тема" : "Тёмная тема"
          }
        >
          {theme === "dark" ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
        </button>
        <Link to="/about" className="header-nav-link">От авторов</Link>
        <a
          href={import.meta.env.VITE_CABINET_URL || "/cabinet/"}
          className="header-nav-link header-nav-cabinet"
          title="Личный кабинет"
          aria-label="Личный кабинет"
          {...((import.meta.env.VITE_CABINET_URL || "").startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        </a>
      </nav>
    </div>
  </div>
</header>


      <aside>
        {/* боковое меню */}
      </aside>

      <main className="container mt-4">
        <Outlet />
      </main>

      <footer className="text-center py-3">
        © 2026
      </footer>

      <script
        src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.min.js"
      ></script>
      </div>
    </div>
  );
}

export default Layout;
