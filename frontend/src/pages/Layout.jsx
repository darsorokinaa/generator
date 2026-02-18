import { Outlet, Link } from "react-router-dom";

function Layout() {
  return (
    <div
      style={{
        backgroundImage: "url('/img/bg.png')",
        backgroundRepeat: "repeat",
        backgroundAttachment: "fixed"
      }}
    >
      <header>
        <div className="container">
          <div className="header-wrapper">
            <div className="logo">
              <Link to="/">
                <span className="logo-icon">∑</span>
                <span className="logo-text">Название</span>
              </Link>
            </div>
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
