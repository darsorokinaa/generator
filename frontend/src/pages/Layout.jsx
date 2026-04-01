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
  const [themeData, setThemeData] = useState(readThemeData);
  const [themeSlides, setThemeSlides] = useState([]);
  const [activeThemeId, setActiveThemeId] = useState(() => {
    try { return sessionStorage.getItem("active_theme_id") || null; } catch { return null; }
  });

  const syncTheme = useCallback(() => {
    setThemeData(readThemeData());
    try { setActiveThemeId(sessionStorage.getItem("active_theme_id") || null); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    window.addEventListener("theme-change", syncTheme);
    return () => window.removeEventListener("theme-change", syncTheme);
  }, [syncTheme]);

  useEffect(() => {
    const root = document.documentElement;
    if (themeData?.decor) {
      root.style.setProperty("--theme-decor-url", `url(${themeData.decor})`);
      root.classList.add("theme-decor-active");
    } else {
      root.style.removeProperty("--theme-decor-url");
      root.classList.remove("theme-decor-active");
    }
    return () => {
      root.style.removeProperty("--theme-decor-url");
      root.classList.remove("theme-decor-active");
    };
  }, [themeData?.decor]);

  useEffect(() => {
    fetch("/api/announcements/", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { announcements: [] }))
      .then((data) => {
        const items = Array.isArray(data.announcements) ? data.announcements : [];
        const themed = items
          .filter((a) => {
            const has = [
              a.theme_overlay_url,
              a.theme_header_bg_url,
              a.theme_logo_url,
              a.theme_decor_url,
              a.theme_worksheet_bg_url,
            ].some((u) => (u || "").trim());
            return has;
          })
          .map((a) => {
            const title = (a.title || "").toLowerCase();
            let kind = "theme";
            if (/пасх|easter/i.test(title)) kind = "easter";
            else if (/косм|cosmos|space/i.test(title)) kind = "cosmos";
            return {
              id: a.id,
              kind,
              title: a.title,
              overlay: (a.theme_overlay_url || "").trim(),
              headerBg: (a.theme_header_bg_url || "").trim(),
              logo: (a.theme_logo_url || "").trim(),
              decor: (a.theme_decor_url || "").trim(),
              worksheetBg: (a.theme_worksheet_bg_url || "").trim(),
            };
          });
        setThemeSlides(themed);
      })
      .catch(() => {});
  }, []);

  const easterSlide = themeSlides.find((s) => s.kind === "easter");
  const cosmosSlide = themeSlides.find((s) => s.kind === "cosmos");

  function toggleTheme(slide) {
    if (!slide) return;
    if (String(activeThemeId) === String(slide.id)) {
      sessionStorage.removeItem("theme_data");
      sessionStorage.removeItem("active_theme_id");
      setActiveThemeId(null);
      setThemeData(null);
    } else {
      const data = {
        overlay: slide.overlay,
        headerBg: slide.headerBg,
        logo: slide.logo,
        decor: slide.decor,
        worksheetBg: slide.worksheetBg,
      };
      sessionStorage.setItem("theme_data", JSON.stringify(data));
      sessionStorage.setItem("active_theme_id", String(slide.id));
      setActiveThemeId(String(slide.id));
      setThemeData(data);
    }
    window.dispatchEvent(new Event("theme-change"));
  }

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
      <div className="app-shell-content">
      <header
        className={themeData?.headerBg ? "header--themed" : undefined}
        style={themeData?.headerBg ? { backgroundImage: `url(${themeData.headerBg})` } : undefined}
      >
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
        {activeThemeId && (
          <button
            type="button"
            className="theme-toggle theme-toggle-reset"
            onClick={() => {
              sessionStorage.removeItem("theme_data");
              sessionStorage.removeItem("active_theme_id");
              setActiveThemeId(null);
              setThemeData(null);
              window.dispatchEvent(new Event("theme-change"));
            }}
            aria-label="Обычный стиль"
            title="Обычный стиль"
          >
            <span style={{ fontSize: "18px", lineHeight: 1 }}>🏠</span>
          </button>
        )}
        {easterSlide && (
          <button
            type="button"
            className={`theme-toggle${activeThemeId === String(easterSlide.id) ? " theme-toggle--active" : ""}`}
            onClick={() => toggleTheme(easterSlide)}
            aria-pressed={activeThemeId === String(easterSlide.id)}
            aria-label="Пасхальная тема"
            title="Пасхальная тема"
          >
            <span style={{ fontSize: "18px", lineHeight: 1 }}>🐣</span>
          </button>
        )}
        {cosmosSlide && (
          <button
            type="button"
            className={`theme-toggle${activeThemeId === String(cosmosSlide.id) ? " theme-toggle--active" : ""}`}
            onClick={() => toggleTheme(cosmosSlide)}
            aria-pressed={activeThemeId === String(cosmosSlide.id)}
            aria-label="Космическая тема"
            title="Космическая тема"
          >
            <span style={{ fontSize: "18px", lineHeight: 1 }}>🪐</span>
          </button>
        )}
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
