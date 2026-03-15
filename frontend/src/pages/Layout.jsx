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
