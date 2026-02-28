import { useParams, Link, useNavigate } from "react-router-dom";
import NotFoundPage from "./NotFoundPage";

const KNOWN_LEVELS = ["oge", "ege"];

function SubjectPage() {
  const { level } = useParams();
  const navigate = useNavigate();

  if (!KNOWN_LEVELS.includes(level)) return <NotFoundPage />;

  function handleSearchTask(e) {
    e.preventDefault();
    const form = e.target;
    const query = form.query.value?.trim();
    if (query) {
      navigate(`/search/tasks?q=${encodeURIComponent(query)}`);
    }
  }

  function handleSearchVariant(e) {
    e.preventDefault();
    const form = e.target;
    const query = form.query.value?.trim();
    if (query) {
      navigate(`/search-variant?q=${encodeURIComponent(query)}`);
    }
  }



  

  return (
    <div className="subject-page">
      <div className="container subject-page-container">
        <div className="subject-page-layout">
          <div className="subject-page-main">
            <div className="hero">
              <h1>Выбор предмета</h1>
              <p>
                Выберите предмет для работы с классом. Готовые задания и варианты для уроков, контрольных и домашней работы.
              </p>
            </div>

            <div className="exam-grid">

        <Link
          to={`/${level}/math`}
          className="exam-card exam-card-math"
        >
          <div className="exam-card-bg" aria-hidden="true">
            <span className="exam-card-decor exam-card-decor-calc">📐</span>
            <span className="exam-card-decor exam-card-decor-ruler">📏</span>
            <span className="exam-card-decor exam-card-decor-sparkle">✦</span>
            <span className="exam-card-decor exam-card-decor-sparkle exam-card-decor-sparkle-2">✦</span>
            <span className="exam-card-decor exam-card-decor-sparkle exam-card-decor-sparkle-3">✦</span>
          </div>
          <div className="exam-card-main">
            <div className="exam-card-left">
              <div className="exam-icon exam-icon-math">🔢</div>
              <div className="exam-card-text">
                <h3 className="exam-title">Математика</h3>
                <p className="exam-description">
                  Алгебра, геометрия, теория вероятностей и математический анализ
                </p>
              </div>
            </div>
            <div className="exam-card-footer">
              <span className="exam-badge">Все разделы</span>
              <div className="exam-card-arrow-wrap">
                <span className="exam-arrow" aria-hidden="true">→</span>
              </div>
            </div>
          </div>
        </Link>

        <Link
          to={`/${level}/inf`}
          className="exam-card exam-card-inf"
        >
          <div className="exam-card-bg" aria-hidden="true">
            <span className="exam-card-decor exam-card-decor-calc">📐</span>
            <span className="exam-card-decor exam-card-decor-ruler">📏</span>
            <span className="exam-card-decor exam-card-decor-sparkle">✦</span>
            <span className="exam-card-decor exam-card-decor-sparkle exam-card-decor-sparkle-2">✦</span>
            <span className="exam-card-decor exam-card-decor-sparkle exam-card-decor-sparkle-3">✦</span>
          </div>
          <div className="exam-card-main">
            <div className="exam-card-left">
              <div className="exam-icon exam-icon-inf">💻</div>
              <div className="exam-card-text">
                <h3 className="exam-title">Информатика</h3>
                <p className="exam-description">
                  Алгоритмы, программирование, логика и компьютерные системы
                </p>
              </div>
            </div>
            <div className="exam-card-footer">
              <span className="exam-badge">Все темы</span>
              <div className="exam-card-arrow-wrap">
                <span className="exam-arrow" aria-hidden="true">→</span>
              </div>
            </div>
          </div>
        </Link>
            </div>
          </div>

          <aside className="subject-page-sidebar">
            <div className="subject-sidebar-card subject-sidebar-search">
              <form onSubmit={handleSearchTask} className="subject-sidebar-search-form">
                <label className="subject-sidebar-label" htmlFor="search-task">Поиск задачи</label>
                <div className="subject-sidebar-search-row">
                  <input id="search-task" name="query" type="text" className="subject-sidebar-input" placeholder="" />
                  <button type="submit" className="subject-sidebar-btn-find">Найти</button>
                </div>
              </form>
              <form onSubmit={handleSearchVariant} className="subject-sidebar-search-form">
                <label className="subject-sidebar-label" htmlFor="search-variant">Поиск варианта</label>
                <div className="subject-sidebar-search-row">
                  <input id="search-variant" name="query" type="text" className="subject-sidebar-input" placeholder="" />
                  <button type="submit" className="subject-sidebar-btn-find">Найти</button>
                </div>
              </form>
            </div>
            <div className="subject-sidebar-card subject-sidebar-support">
              <h3 className="subject-sidebar-title">Группа поддержки</h3>
              <p className="subject-sidebar-text">
                Это пространство для живого общения с нами. Здесь можно делиться идеями, предлагать новые функции, писать о трудностях и просто быть на связи, чтобы узнавать обо всех обновлениях.
              </p>
              <p className="subject-sidebar-text">
                Вступайте в группу — вместе мы делаем платформу удобнее и полезнее для вас.
              </p>
              <a href="https://t.me/example_focus_group" target="_blank" rel="noopener noreferrer" className="subject-sidebar-btn">Вступайте в группу</a>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

export default SubjectPage;
