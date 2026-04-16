import { useEffect, useLayoutEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

function IndexPage() {
  const navigate = useNavigate();
  const [updates, setUpdates] = useState([]);

  useLayoutEffect(() => {
    document.body.classList.add("index");
    return () => document.body.classList.remove("index");
  }, []);

  useEffect(() => {
    fetch("/api/updates/", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : { updates: [] }))
      .then((data) => setUpdates(Array.isArray(data.updates) ? data.updates : []))
      .catch(() => setUpdates([]));
  }, []);

  return (
    <div>
      {/*
      Верхний welcome-banner (слайдер объявлений) отключён — текст, сова и CTA перенесены в блок «Добро пожаловать» ниже.
      <section className={`welcome-banner${currentSlideIsLight ? " welcome-banner--light" : ""}`} aria-label="О платформе">
        ...
      </section>
      */}

      <div className="index-desktop-wrap">
        <div className="index-main">
          

          <div className="hero hero--index-welcome" aria-label="Добро пожаловать">
            <div className="hero-index-welcome-inner">
              <h1>
                Платформа для{"\u00A0"}подготовки к{"\u00A0"}ОГЭ и{"\u00A0"}ЕГЭ
              </h1>

              <p className="hero-index-platform-text">
                {`Удобные материалы и\u00A0генератор заданий для\u00A0уроков и\u00A0домашней работы. Актуальная структура по\u00A0предметам, готовые варианты и\u00A0подборки по\u00A0темам, чтобы\u00A0готовить учеников к\u00A0экзаменам системно и\u00A0с\u00A0меньшими затратами времени.`}
              </p>
              <p className="hero-index-platform-title">Добро пожаловать!</p>
              {/* <button
                type="button"
                className="hero-index-cta"
                onClick={() => document.getElementById("exam-choice")?.scrollIntoView({ behavior: "smooth" })}
              >
                к материалам
              </button> */}
            </div>
            <img
              src={`${import.meta.env.BASE_URL}img/banner-owl.png`}
              alt=""
              className="hero-owl"
              aria-hidden="true"
            />
          </div>

          <div id="exam-choice" className="exam-grid exam-choice-pair">

            <div
              className="exam-card exam-card-oge"
              onClick={() => navigate("/oge")}
              style={{ cursor: "pointer" }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && navigate("/oge")}
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
                  <div className="exam-icon exam-icon-oge">📝</div>
                  <div className="exam-card-text">
                    <h3 className="exam-title">ОГЭ</h3>
                    <p className="exam-description">Основной государственный экзамен</p>
                  </div>
                </div>
                <div className="exam-card-footer">
                  <span className="exam-badge">9 класс</span>
                  <div className="exam-card-arrow-wrap">
                    <span className="exam-arrow" aria-hidden="true">→</span>
                  </div>
                </div>
              </div>
            </div>

            <div
              className="exam-card exam-card-ege"
              onClick={() => navigate("/ege")}
              style={{ cursor: "pointer" }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && navigate("/ege")}
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
                  <div className="exam-icon exam-icon-ege">🎓</div>
                  <div className="exam-card-text">
                    <h3 className="exam-title">ЕГЭ</h3>
                    <p className="exam-description">Единый государственный экзамен</p>
                  </div>
                </div>
                <div className="exam-card-footer">
                  <span className="exam-badge">11 класс</span>
                  <div className="exam-card-arrow-wrap">
                    <span className="exam-arrow" aria-hidden="true">→</span>
                  </div>
                </div>
              </div>
            </div>

          </div>

          <section className="steps-block" aria-label="Этапы подготовки">
            <h2 className="steps-block-title">Инструкция</h2>
            <ol className="steps-list">
              <li className="steps-item">
                <span className="steps-num" aria-hidden="true">1</span>
                <div className="steps-content">
                  <h3 className="steps-item-title">
                    Выбирайте экзамен{"\u00A0"}и предмет
                  </h3>
                  <p className="steps-item-text">
                    Сейчас доступны профильная математика{"\u00A0"}и информатика, другие предметы уже на подходе!
                  </p>
                </div>
              </li>
              <li className="steps-item">
                <span className="steps-num" aria-hidden="true">2</span>
                <div className="steps-content">
                  <h3 className="steps-item-title">Генерируйте уникальный тренировочный вариант</h3>
                  <p className="steps-item-text">
                    Все задания из актуальных материалов с автопроверкой. А{"\u00A0"}еще платформа работает как онлайн-доска:
                    записывайте решения прямо рядом с заданиями.
                  </p>
                </div>
              </li>
              <li className="steps-item">
                <span className="steps-num" aria-hidden="true">3</span>
                <div className="steps-content">
                  <h3 className="steps-item-title">Сохраняйте вариант в PDF</h3>
                  <p className="steps-item-text">
                    Возвращайтесь к сохраненным файлам в любой момент с помощью поиска по вариантам{"\u00A0"}и сверяйте ответы.
                  </p>
                </div>
              </li>
              <li className="steps-item">
                <span className="steps-num" aria-hidden="true">4</span>
                <div className="steps-content">
                  <h3 className="steps-item-title">Тренируйтесь на отдельных заданиях</h3>
                  <p className="steps-item-text">
                    Создавайте тесты с автопроверкой для разминки или целенаправленной отработки конкретных номеров,
                    {"\u00A0"}чтобы совершенствовать результаты.
                  </p>
                </div>
              </li>
            </ol>
          </section>
        </div>

        {updates.length > 0 && (
          <section className="index-updates-block" aria-label="Обновления платформы">
            <h2 className="index-updates-title">Обновления</h2>
            <ul className="index-updates-list">
              {updates.map((u) => (
                <li key={u.id} className="index-updates-item">
                  <time className="index-updates-date" dateTime={u.created_iso || undefined}>{u.created_display}</time>
                  <h3 className="index-updates-item-title">{u.title}</h3>
                  {u.description ? <p className="index-updates-text">{u.description}</p> : null}
                </li>
              ))}
            </ul>
          </section>
        )}

      </div>

    </div>
  );
}

export default IndexPage;