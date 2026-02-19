import { Outlet, Link } from "react-router-dom";

function Layout() {
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
          <img
            className="logo-img"
            src={`${import.meta.env.BASE_URL}img/logo.png`}
            alt="ЛАБОБОР"
          />
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
