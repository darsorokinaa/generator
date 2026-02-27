import { useNavigate } from "react-router-dom";

function IndexPage() {
  const navigate = useNavigate();

  return (
    <div>

      <section className="welcome-banner" aria-label="О платформе">
        <img
          src={`${import.meta.env.BASE_URL}img/banner-owl.png`}
          alt=""
          className="welcome-banner-owl"
          aria-hidden="true"
        />
        <h2 className="welcome-banner-title">
          Платформа для подготовки к ОГЭ и ЕГЭ
        </h2>
        <p className="welcome-banner-text">
          Удобные материалы и генератор заданий для уроков и домашней работы. Актуальная структура по предметам, готовые варианты и подборки по темам — чтобы готовить класс к экзаменам системно и с меньшими затратами времени.
        </p>
        <button
          type="button"
          className="welcome-banner-cta"
          onClick={() => document.getElementById("exam-choice")?.scrollIntoView({ behavior: "smooth" })}
        >
          к материалам
        </button>
      </section>

      <div className="index-desktop-wrap">
        <section className="steps-block" aria-label="Этапы подготовки">
          <h2 className="steps-block-title">Инструкция</h2>
          <ol className="steps-list">
            <li className="steps-item">
              <span className="steps-num" aria-hidden="true">1</span>
              <div className="steps-content">
                <h3 className="steps-item-title">Выбирайте экзамен и предмет</h3>
                <p className="steps-item-text">Сейчас доступны математика и информатика, другие предметы уже на подходе!</p>
              </div>
            </li>
            <li className="steps-item">
              <span className="steps-num" aria-hidden="true">2</span>
              <div className="steps-content">
                <h3 className="steps-item-title">Генерируйте уникальный тренировочный вариант</h3>
                <p className="steps-item-text">Все задания из актуальных материалов с автопроверкой. А еще платформа работает как онлайн-доска: записывайте решения прямо рядом с заданиями.</p>
              </div>
            </li>
            <li className="steps-item">
              <span className="steps-num" aria-hidden="true">3</span>
              <div className="steps-content">
                <h3 className="steps-item-title">Сохраняйте вариант в PDF</h3>
                <p className="steps-item-text">Возвращайтесь к сохраненным файлам в любой момент с помощью поиска по вариантам и сверяйте ответы. Мы добавили функцию с красивым цветным оформлением, потому что учиться должно быть приятно.</p>
              </div>
            </li>
            <li className="steps-item">
              <span className="steps-num" aria-hidden="true">4</span>
              <div className="steps-content">
                <h3 className="steps-item-title">Тренируйтесь на отдельных заданиях</h3>
                <p className="steps-item-text">Создавайте тесты с автопроверкой для разминки или целенаправленной отработки конкретных номеров, чтобы совершенствовать результаты.</p>
              </div>
            </li>
          </ol>
        </section>

        <div className="index-main">
          <div className="hero">
            <h1>Добро пожаловать!</h1>
            <p>
              Здесь вы можете подбирать задания и готовить материалы для уроков по ОГЭ и ЕГЭ.
              Выберите формат экзамена и предмет — и приступайте к работе с классом.
            </p>
          </div>

          <div id="exam-choice" className="exam-grid">

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
                <p className="exam-description">
                  Основной государственный экзамен
                </p>
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
                <p className="exam-description">
                  Единый государственный экзамен
                </p>
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
        </div>
      </div>

    </div>
  );
}

export default IndexPage;
