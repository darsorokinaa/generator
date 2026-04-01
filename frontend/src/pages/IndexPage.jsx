import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

function AnnouncementCta({ url, label }) {
  const href = (url || "").trim();
  const text = (label || "").trim();
  if (!href || !text) return null;
  const external = /^https?:\/\//i.test(href);
  const className = "announcement-card-cta";
  if (external) {
    return (
      <a className={className} href={href} target="_blank" rel="noopener noreferrer">
        {text}
      </a>
    );
  }
  const to = href.startsWith("/") ? href : `/${href}`;
  return (
    <Link className={className} to={to}>
      {text}
    </Link>
  );
}

function stripHtml(html) {
  if (!html) return "";
  if (typeof window === "undefined") {
    return String(html).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  }
  const temp = document.createElement("div");
  temp.innerHTML = String(html);
  return (temp.textContent || temp.innerText || "").replace(/\s+/g, " ").trim();
}

function clampText(value, maxLength = 260) {
  const text = (value || "").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trimEnd()}...`;
}

function getImageBrightness(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const size = 64;
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, size, size);
      let data;
      try {
        data = ctx.getImageData(0, 0, size, size).data;
      } catch {
        resolve(null);
        return;
      }
      let totalLum = 0;
      let count = 0;
      for (let i = 0; i < data.length; i += 16) {
        totalLum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        count++;
      }
      resolve(count > 0 ? totalLum / count : null);
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function IndexPage() {
  const navigate = useNavigate();
  const [updates, setUpdates] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [welcomeSlideIndex, setWelcomeSlideIndex] = useState(0);
  const [slideBgLight, setSlideBgLight] = useState({});
  const [pinnedThemeId, setPinnedThemeId] = useState(() => {
    try { return sessionStorage.getItem("active_theme_id") || null; } catch { return null; }
  });

  const welcomeSlides = useMemo(() => {
    const firstSlide = {
      id: "default-welcome-slide",
      title: "Платформа для подготовки к ОГЭ и ЕГЭ",
      bodyHtml: "",
      textPlain: "Удобные материалы и генератор заданий для уроков и домашней работы. Актуальная структура по предметам, готовые варианты и подборки по темам — чтобы готовить класс к экзаменам системно и с меньшими затратами времени.",
      cta: "к материалам",
      buttonUrl: "",
      hasButton: false,
      image: "img/banner-owl.png",
      backgroundUrl: "",
    };

    const announcementSlides = announcements.map((a) => {
      const themeOverlay = (a.theme_overlay_url || "").trim();
      const themeHeaderBg = (a.theme_header_bg_url || "").trim();
      const themeLogo = (a.theme_logo_url || "").trim();
      const themeDecor = (a.theme_decor_url || "").trim();
      const themeWorksheetBg = (a.theme_worksheet_bg_url || "").trim();
      return {
        id: a.id,
        title: (a.title || "").trim() || "Объявление",
        bodyHtml: (a.body || "").trim(),
        textPlain: "",
        cta: (a.button_label || "").trim() || "к материалам",
        buttonUrl: (a.button_url || "").trim(),
        hasButton: Boolean(a.has_button),
        image: (a.image_url || "").trim() || "img/banner-owl12.png",
        backgroundUrl: (a.background_url || "").trim(),
        themeOverlay,
        themeHeaderBg,
        themeLogo,
        themeDecor,
        themeWorksheetBg,
        hasTheme: !!(themeOverlay || themeHeaderBg || themeLogo || themeDecor || themeWorksheetBg),
      };
    });

    return [firstSlide, ...announcementSlides];
  }, [announcements]);

  const goToNextWelcomeSlide = useCallback(() => {
    setPinnedThemeId(null);
    setWelcomeSlideIndex((prev) => (prev + 1) % welcomeSlides.length);
  }, [welcomeSlides.length]);
  const goToPrevWelcomeSlide = useCallback(() => {
    setPinnedThemeId(null);
    setWelcomeSlideIndex((prev) => (prev - 1 + welcomeSlides.length) % welcomeSlides.length);
  }, [welcomeSlides.length]);

  useEffect(() => {
    fetch("/api/updates/", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : { updates: [] }))
      .then((data) => setUpdates(Array.isArray(data.updates) ? data.updates : []))
      .catch(() => setUpdates([]));
  }, []);

  useEffect(() => {
    fetch("/api/announcements/", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : { announcements: [] }))
      .then((data) =>
        setAnnouncements(Array.isArray(data.announcements) ? data.announcements : [])
      )
      .catch(() => setAnnouncements([]));
  }, []);

  useEffect(() => {
    const onThemeChange = () => {
      const id = sessionStorage.getItem("active_theme_id") || null;
      setPinnedThemeId(id);
      if (id) {
        const idx = welcomeSlides.findIndex((s) => String(s.id) === String(id));
        if (idx >= 0) setWelcomeSlideIndex(idx);
      }
    };
    window.addEventListener("theme-change", onThemeChange);
    return () => window.removeEventListener("theme-change", onThemeChange);
  }, [welcomeSlides]);

  useEffect(() => {
    if (pinnedThemeId) {
      const idx = welcomeSlides.findIndex((s) => String(s.id) === String(pinnedThemeId));
      if (idx >= 0) setWelcomeSlideIndex(idx);
      return undefined;
    }
    if (welcomeSlides.length < 2) return undefined;
    const sliderTimer = window.setInterval(() => {
      setWelcomeSlideIndex((prev) => (prev + 1) % welcomeSlides.length);
    }, 7000);
    return () => window.clearInterval(sliderTimer);
  }, [welcomeSlides.length, pinnedThemeId, welcomeSlides]);

  useEffect(() => {
    setWelcomeSlideIndex((prev) => (prev >= welcomeSlides.length ? 0 : prev));
  }, [welcomeSlides.length]);

  useEffect(() => {
    let cancelled = false;
    const urls = welcomeSlides
      .filter((s) => s.backgroundUrl)
      .map((s) => ({ id: s.id, url: s.backgroundUrl }));
    if (urls.length === 0) return;

    (async () => {
      const results = {};
      await Promise.all(
        urls.map(async ({ id, url }) => {
          const brightness = await getImageBrightness(url);
          if (brightness !== null) {
            results[id] = brightness > 160;
          }
        })
      );
      if (!cancelled) setSlideBgLight((prev) => ({ ...prev, ...results }));
    })();

    return () => { cancelled = true; };
  }, [welcomeSlides]);

  const currentSlide = welcomeSlides[welcomeSlideIndex] || welcomeSlides[0];
  const currentSlideIsLight = slideBgLight[currentSlide.id] === true;

  return (
    <div>
      <section className={`welcome-banner${currentSlideIsLight ? " welcome-banner--light" : ""}`} aria-label="О платформе">
        {welcomeSlides.length > 1 ? (
          <>
            <button
              type="button"
              className="welcome-banner-nav welcome-banner-nav-prev"
              aria-label="Предыдущий слайд"
              onClick={goToPrevWelcomeSlide}
            >
              ‹
            </button>
            <button
              type="button"
              className="welcome-banner-nav welcome-banner-nav-next"
              aria-label="Следующий слайд"
              onClick={goToNextWelcomeSlide}
            >
              ›
            </button>
          </>
        ) : null}

        <div className="welcome-banner-slides">
          {welcomeSlides.map((slide, i) => (
            <div
              key={slide.id}
              className={`welcome-banner-slide${i === welcomeSlideIndex ? " welcome-banner-slide--active" : ""}${slide.backgroundUrl ? " welcome-banner-slide--has-bg" : ""}${slideBgLight[slide.id] ? " welcome-banner-slide--light-bg" : ""}`}
              style={slide.backgroundUrl ? { backgroundImage: `url(${slide.backgroundUrl})` } : undefined}
              aria-hidden={i !== welcomeSlideIndex}
            >
              <img
                src={
                  /^https?:\/\//i.test(slide.image)
                    ? slide.image
                    : `${import.meta.env.BASE_URL}${slide.image.replace(/^\//, "")}`
                }
                alt=""
                className={`welcome-banner-owl${slide.id === "default-welcome-slide" ? "" : " welcome-banner-owl--db"}`}
                aria-hidden="true"
              />
              <h2 className="welcome-banner-title">{slide.title}</h2>
              {slide.bodyHtml ? (
                <div
                  className="welcome-banner-text"
                  dangerouslySetInnerHTML={{ __html: slide.bodyHtml }}
                />
              ) : (
                <p className="welcome-banner-text">{slide.textPlain}</p>
              )}
              <button
                type="button"
                className="welcome-banner-cta"
                tabIndex={i === welcomeSlideIndex ? 0 : -1}
                onClick={() => {
                  if (slide.hasTheme) {
                    const currentId = sessionStorage.getItem("active_theme_id");
                    if (String(currentId) === String(slide.id)) {
                      sessionStorage.removeItem("theme_data");
                      sessionStorage.removeItem("active_theme_id");
                    } else {
                      sessionStorage.setItem("theme_data", JSON.stringify({
                        overlay: slide.themeOverlay,
                        headerBg: slide.themeHeaderBg,
                        logo: slide.themeLogo,
                        decor: slide.themeDecor,
                        worksheetBg: slide.themeWorksheetBg,
                      }));
                      sessionStorage.setItem("active_theme_id", String(slide.id));
                    }
                    window.dispatchEvent(new Event("theme-change"));
                    return;
                  }
                  if (!slide.hasButton || !slide.buttonUrl) {
                    document.getElementById("exam-choice")?.scrollIntoView({ behavior: "smooth" });
                    return;
                  }
                  const href = slide.buttonUrl;
                  const isExternal = /^https?:\/\//i.test(href);
                  if (isExternal) {
                    window.open(href, "_blank", "noopener,noreferrer");
                    return;
                  }
                  navigate(href.startsWith("/") ? href : `/${href}`);
                }}
              >
                {slide.cta}
              </button>
            </div>
          ))}
        </div>
      </section>

      <div className="index-desktop-wrap">
        <div className="index-main">
          

          <div className="hero">
            <h1>Добро пожаловать!</h1>
            <p>
              Здесь вы можете подбирать задания и готовить материалы для уроков по ОГЭ и ЕГЭ.
              Выберите формат экзамена и предмет — и приступайте к работе с классом.
            </p>
          </div>
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