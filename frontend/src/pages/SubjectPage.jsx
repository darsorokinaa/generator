import { useEffect, useRef, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import NotFoundPage from "./NotFoundPage";

const KNOWN_LEVELS = ["oge", "ege"];

function SubjectPage() {
  const { level } = useParams();
  const navigate = useNavigate();
  const [blockedNotice, setBlockedNotice] = useState(false);
  const blockedNoticeTimeoutRef = useRef(null);

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

  function handleLockedSubjectClick(e) {
    e.preventDefault();
    if (blockedNoticeTimeoutRef.current) {
      window.clearTimeout(blockedNoticeTimeoutRef.current);
    }
    setBlockedNotice(true);
    blockedNoticeTimeoutRef.current = window.setTimeout(() => {
      setBlockedNotice(false);
      blockedNoticeTimeoutRef.current = null;
    }, 2200);
  }

  useEffect(() => {
    return () => {
      if (blockedNoticeTimeoutRef.current) {
        window.clearTimeout(blockedNoticeTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div className="subject-page">
      <div className="container subject-page-container">
        <div className="subject-page-layout">
          <div className="subject-page-main">
              <div className="hero">
                <h1>Выбор предмета</h1>
                <p>
                  Выберите предмет для работы с учениками. Готовые задания и варианты для уроков, контрольных и домашней работы.
                </p>
              </div>
              {blockedNotice ? (
                <div className="subject-lock-notice" role="status" aria-live="polite">
                  Доступ заблокирован. Предмет скоро появится.
                </div>
              ) : null}

              <div className="subject-page-pick-groups">
                <div className="subject-page-pick-block">
                  {level === "ege" && (
                  <div className="subject-page-subject-pair subject-page-subject-pair--math-base">
                    <Link
                      to={`/${level}/math_base`}
                      className="exam-card exam-card-math-base"
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
                            <h3 className="exam-title">Математика (базовая)</h3>
                            <p className="exam-description">
                              Вычисления, уравнения и прикладные задачи базового уровня.
                            </p>
                          </div>
                        </div>
                        <div className="exam-card-footer">
                          <span className="exam-badge">Перейти</span>
                          <div className="exam-card-arrow-wrap">
                            <span className="exam-arrow" aria-hidden="true">→</span>
                          </div>
                        </div>
                      </div>
                    </Link>
                  </div>
                  )}

                  <div className="subject-page-subject-pair subject-page-subject-pair--math">
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
                            <h3 className="exam-title">
                              {level === "ege" ? "Математика (профиль)" : "Математика"}
                            </h3>
                            <p className="exam-description">
                              Алгебра, геометрия и задачи с реальными экзаменационными форматами.
                            </p>
                          </div>
                        </div>
                        <div className="exam-card-footer">
                          <span className="exam-badge">Перейти</span>
                          <div className="exam-card-arrow-wrap">
                            <span className="exam-arrow" aria-hidden="true">→</span>
                          </div>
                        </div>
                      </div>
                    </Link>
                  </div>

                  <div className="subject-page-subject-pair subject-page-subject-pair--inf">
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
                              Алгоритмы, программирование и практические задания по логике решений.
                            </p>
                          </div>
                        </div>
                        <div className="exam-card-footer">
                          <span className="exam-badge">Перейти</span>
                          <div className="exam-card-arrow-wrap">
                            <span className="exam-arrow" aria-hidden="true">→</span>
                          </div>
                        </div>
                      </div>
                    </Link>
                  </div>

                  <div className="subject-page-subject-pair subject-page-subject-pair--phys">
                    <Link
                      to={`/${level}/phys`}
                      className="exam-card exam-card-phys exam-card--locked"
                      onClick={handleLockedSubjectClick}
                      aria-disabled="true"
                    >
                      <div className="exam-card-bg" aria-hidden="true">
                        <span className="exam-card-decor exam-card-decor-calc">⚡</span>
                        <span className="exam-card-decor exam-card-decor-ruler">🔭</span>
                        <span className="exam-card-decor exam-card-decor-sparkle">✦</span>
                        <span className="exam-card-decor exam-card-decor-sparkle exam-card-decor-sparkle-2">✦</span>
                        <span className="exam-card-decor exam-card-decor-sparkle exam-card-decor-sparkle-3">✦</span>
                      </div>
                      <div className="exam-card-main">
                        <div className="exam-card-left">
                          <div className="exam-icon exam-icon-phys">🌡️</div>
                          <div className="exam-card-text">
                            <h3 className="exam-title">Физика</h3>
                            <p className="exam-description">
                              Механика, электродинамика и расчётные задачи с пояснением шагов.
                            </p>
                          </div>
                        </div>
                        <div className="exam-card-footer">
                          <span className="exam-badge exam-badge--soon">Скоро</span>
                          <div className="exam-card-arrow-wrap">
                            <span className="exam-arrow" aria-hidden="true">→</span>
                          </div>
                        </div>
                      </div>
                    </Link>
                  </div>

                  <div className="subject-page-subject-pair subject-page-subject-pair--chem">
                    <Link
                      to={`/${level}/chem`}
                      className="exam-card exam-card-chem exam-card--locked"
                      onClick={handleLockedSubjectClick}
                      aria-disabled="true"
                    >
                      <div className="exam-card-bg" aria-hidden="true">
                        <span className="exam-card-decor exam-card-decor-calc">🧪</span>
                        <span className="exam-card-decor exam-card-decor-ruler">⚗️</span>
                        <span className="exam-card-decor exam-card-decor-sparkle">✦</span>
                        <span className="exam-card-decor exam-card-decor-sparkle exam-card-decor-sparkle-2">✦</span>
                        <span className="exam-card-decor exam-card-decor-sparkle exam-card-decor-sparkle-3">✦</span>
                      </div>
                      <div className="exam-card-main">
                        <div className="exam-card-left">
                          <div className="exam-icon exam-icon-chem">🧬</div>
                          <div className="exam-card-text">
                            <h3 className="exam-title">Химия</h3>
                            <p className="exam-description">
                              Неорганика, органика и расчётные задачи с типовыми схемами.
                            </p>
                          </div>
                        </div>
                        <div className="exam-card-footer">
                          <span className="exam-badge exam-badge--soon">Скоро</span>
                          <div className="exam-card-arrow-wrap">
                            <span className="exam-arrow" aria-hidden="true">→</span>
                          </div>
                        </div>
                      </div>
                    </Link>
                  </div>

                  <div className="subject-page-subject-pair subject-page-subject-pair--bio">
                    <Link
                      to={`/${level}/bio`}
                      className="exam-card exam-card-bio exam-card--locked"
                      onClick={handleLockedSubjectClick}
                      aria-disabled="true"
                    >
                      <div className="exam-card-bg" aria-hidden="true">
                        <span className="exam-card-decor exam-card-decor-calc">🌿</span>
                        <span className="exam-card-decor exam-card-decor-ruler">🔬</span>
                        <span className="exam-card-decor exam-card-decor-sparkle">✦</span>
                        <span className="exam-card-decor exam-card-decor-sparkle exam-card-decor-sparkle-2">✦</span>
                        <span className="exam-card-decor exam-card-decor-sparkle exam-card-decor-sparkle-3">✦</span>
                      </div>
                      <div className="exam-card-main">
                        <div className="exam-card-left">
                          <div className="exam-icon exam-icon-bio">🦠</div>
                          <div className="exam-card-text">
                            <h3 className="exam-title">Биология</h3>
                            <p className="exam-description">
                              Клетка, генетика, экология и задания на анализ биологических процессов.
                            </p>
                          </div>
                        </div>
                        <div className="exam-card-footer">
                          <span className="exam-badge exam-badge--soon">Скоро</span>
                          <div className="exam-card-arrow-wrap">
                            <span className="exam-arrow" aria-hidden="true">→</span>
                          </div>
                        </div>
                      </div>
                    </Link>
                  </div>

                  <div className="subject-page-subject-pair subject-page-subject-pair--history">
                    <Link
                      to={`/${level}/history`}
                      className="exam-card exam-card-history exam-card--locked"
                      onClick={handleLockedSubjectClick}
                      aria-disabled="true"
                    >
                      <div className="exam-card-bg" aria-hidden="true">
                        <span className="exam-card-decor exam-card-decor-calc">📜</span>
                        <span className="exam-card-decor exam-card-decor-ruler">📖</span>
                        <span className="exam-card-decor exam-card-decor-sparkle">✦</span>
                        <span className="exam-card-decor exam-card-decor-sparkle exam-card-decor-sparkle-2">✦</span>
                        <span className="exam-card-decor exam-card-decor-sparkle exam-card-decor-sparkle-3">✦</span>
                      </div>
                      <div className="exam-card-main">
                        <div className="exam-card-left">
                          <div className="exam-icon exam-icon-history">🏛️</div>
                          <div className="exam-card-text">
                            <h3 className="exam-title">История</h3>
                            <p className="exam-description">
                              Россия и мир: даты, события, источники и причинно-следственные связи.
                            </p>
                          </div>
                        </div>
                        <div className="exam-card-footer">
                          <span className="exam-badge exam-badge--soon">Скоро</span>
                          <div className="exam-card-arrow-wrap">
                            <span className="exam-arrow" aria-hidden="true">→</span>
                          </div>
                        </div>
                      </div>
                    </Link>
                  </div>

                  <div className="subject-page-subject-pair subject-page-subject-pair--rus">
                    <Link
                      to={`/${level}/rus`}
                      className="exam-card exam-card-rus exam-card--locked"
                      onClick={handleLockedSubjectClick}
                      aria-disabled="true"
                    >
                      <div className="exam-card-bg" aria-hidden="true">
                        <span className="exam-card-decor exam-card-decor-calc">📖</span>
                        <span className="exam-card-decor exam-card-decor-ruler">✍️</span>
                        <span className="exam-card-decor exam-card-decor-sparkle">✦</span>
                        <span className="exam-card-decor exam-card-decor-sparkle exam-card-decor-sparkle-2">✦</span>
                        <span className="exam-card-decor exam-card-decor-sparkle exam-card-decor-sparkle-3">✦</span>
                      </div>
                      <div className="exam-card-main">
                        <div className="exam-card-left">
                          <div className="exam-icon exam-icon-rus">📚</div>
                          <div className="exam-card-text">
                            <h3 className="exam-title">Русский язык</h3>
                            <p className="exam-description">
                              Орфография, пунктуация и практика работы с текстом и аргументацией.
                            </p>
                          </div>
                        </div>
                        <div className="exam-card-footer">
                          <span className="exam-badge exam-badge--soon">Скоро</span>
                          <div className="exam-card-arrow-wrap">
                            <span className="exam-arrow" aria-hidden="true">→</span>
                          </div>
                        </div>
                      </div>
                    </Link>
                  </div>

                  <div className="subject-page-subject-pair subject-page-subject-pair--lit">
                    <Link
                      to={`/${level}/lit`}
                      className="exam-card exam-card-lit exam-card--locked"
                      onClick={handleLockedSubjectClick}
                      aria-disabled="true"
                    >
                      <div className="exam-card-bg" aria-hidden="true">
                        <span className="exam-card-decor exam-card-decor-calc">📕</span>
                        <span className="exam-card-decor exam-card-decor-ruler">✒️</span>
                        <span className="exam-card-decor exam-card-decor-sparkle">✦</span>
                        <span className="exam-card-decor exam-card-decor-sparkle exam-card-decor-sparkle-2">✦</span>
                        <span className="exam-card-decor exam-card-decor-sparkle exam-card-decor-sparkle-3">✦</span>
                      </div>
                      <div className="exam-card-main">
                        <div className="exam-card-left">
                          <div className="exam-icon exam-icon-lit">📖</div>
                          <div className="exam-card-text">
                            <h3 className="exam-title">Литература</h3>
                            <p className="exam-description">
                              Поэзия и проза, анализ произведений и подготовка к сочинению.
                            </p>
                          </div>
                        </div>
                        <div className="exam-card-footer">
                          <span className="exam-badge exam-badge--soon">Скоро</span>
                          <div className="exam-card-arrow-wrap">
                            <span className="exam-arrow" aria-hidden="true">→</span>
                          </div>
                        </div>
                      </div>
                    </Link>
                  </div>
                </div>
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
                <a href="http://t.me/genurok" target="_blank" rel="noopener noreferrer" className="subject-sidebar-btn">Присоединиться</a>
              </div>
            </aside>
        </div>
      </div>
    </div>
  );
}

export default SubjectPage;
