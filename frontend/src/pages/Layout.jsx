import { useEffect } from "react";
import { Outlet, Link, useLocation } from "react-router-dom";

function Layout() {
  const { pathname } = useLocation();

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
    <div
      style={{
        backgroundImage: `url('${import.meta.env.BASE_URL}img/bg.png')`,
        backgroundRepeat: "repeat",
        backgroundAttachment: "fixed"
      }}
    >
      <header>
      <div className="container">
    <div className="header-wrapper">
      <div className="logo-block">
        <Link to="/" className="logo-link">
          <span className="logo-icon-sum" aria-hidden="true">∑</span>
          <span className="logo-text">Генератор</span>
        </Link>
      </div>
      <nav className="header-nav">
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
  );
}

export default Layout;
