import { useCallback, useEffect, useRef, useState } from "react";
import { Outlet, Link, useLocation } from "react-router-dom";
import {
  readPersistedTheme,
  writePersistedTheme,
  clearPersistedTheme,
} from "../utils/themeStorage";

const COOKIE_CONSENT_KEY = "cookie_consent_accepted";

function Layout() {
  const { pathname } = useLocation();
  const [themeData, setThemeData] = useState(() => readPersistedTheme().themeData);
  const [cookieAccepted, setCookieAccepted] = useState(() => {
    try { return !!localStorage.getItem(COOKIE_CONSENT_KEY); } catch { return false; }
  });

  function acceptCookies() {
    try { localStorage.setItem(COOKIE_CONSENT_KEY, "1"); } catch { /* ignore */ }
    setCookieAccepted(true);
  }
  const [themeSlides, setThemeSlides] = useState([]);
  const [activeThemeId, setActiveThemeId] = useState(() => readPersistedTheme().activeThemeId);

  const themeDataRef = useRef(themeData);
  const activeThemeIdRef = useRef(activeThemeId);
  useEffect(() => {
    themeDataRef.current = themeData;
  }, [themeData]);
  useEffect(() => {
    activeThemeIdRef.current = activeThemeId;
  }, [activeThemeId]);

  const syncTheme = useCallback(() => {
    const next = readPersistedTheme();
    setThemeData(next.themeData);
    setActiveThemeId(next.activeThemeId);
  }, []);

  /** После смены календарного дня (вкладка была в фоне) подтянуть актуальное хранилище. */
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      const next = readPersistedTheme();
      if (
        JSON.stringify(themeDataRef.current) !== JSON.stringify(next.themeData) ||
        activeThemeIdRef.current !== next.activeThemeId
      ) {
        setThemeData(next.themeData);
        setActiveThemeId(next.activeThemeId);
        window.dispatchEvent(new Event("theme-change"));
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
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
      clearPersistedTheme();
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
      writePersistedTheme(data, String(slide.id));
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
              clearPersistedTheme();
              setActiveThemeId(null);
              setThemeData(null);
              const e = new Event("theme-change");
              e.resetToDefault = true;
              window.dispatchEvent(e);
            }}
            aria-label="Обычный стиль"
            title="Обычный стиль"
          >
            <span aria-hidden="true">🏠</span>
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
            <span aria-hidden="true">🐣</span>
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
            <span aria-hidden="true">🪐</span>
          </button>
        )}
        <Link to="/about" className="header-nav-link">От авторов</Link>
        <a
          href="http://lk.genurok.tw1.ru"
          className="header-nav-cabinet"
          target="_blank"
          rel="noopener noreferrer"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{display:"inline-block",verticalAlign:"middle",marginRight:"5px",marginTop:"-2px"}}>
            <circle cx="12" cy="8" r="4"/>
            <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
          </svg>
          Личный кабинет
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

      <footer className="site-footer">
        <div className="site-footer-inner">
          <span className="site-footer-copy">© 2026 ГенУрок</span>
          <div className="site-footer-links">
            <Link to="/privacy" className="site-footer-link">Политика конфиденциальности</Link>
            <span className="site-footer-sep" aria-hidden="true">·</span>
            <Link to="/privacy#pd" className="site-footer-link">Согласие на обработку ПД</Link>
          </div>
        </div>
      </footer>

      {!cookieAccepted && (
        <div className="cookie-banner" role="alertdialog" aria-label="Уведомление об использовании файлов cookie">
          <div className="cookie-banner-inner">
            <p className="cookie-banner-text">
              Мы используем файлы cookie для корректной работы сайта. Продолжая использование сайта, вы соглашаетесь с{" "}
              <Link to="/privacy" className="cookie-banner-link">политикой конфиденциальности</Link> и обработкой персональных данных.
            </p>
            <button type="button" className="cookie-banner-btn" onClick={acceptCookies}>
              Принять
            </button>
          </div>
        </div>
      )}

      <script
        src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.min.js"
      ></script>
      </div>
    </div>
  );
}

export default Layout;
