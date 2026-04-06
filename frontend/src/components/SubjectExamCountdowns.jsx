import { useEffect, useState } from "react";

const JUNE = 5; // месяц 0-based

/** Ближайшая дата экзамена в локальном времени устройства (июнь, 10:00). */
function getNextExamTimestamp(level, subjectKey) {
  const now = Date.now();
  const y0 = new Date().getFullYear();
  const day =
    level === "ege"
      ? subjectKey === "math"
        ? 8
        : 18
      : subjectKey === "math"
        ? 2
        : 6;
  for (let y = y0; y <= y0 + 2; y += 1) {
    const t = new Date(y, JUNE, day, 10, 0, 0, 0).getTime();
    if (t > now) return t;
  }
  return new Date(y0 + 1, JUNE, day, 10, 0, 0, 0).getTime();
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function splitRemain(ms) {
  if (ms <= 0) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0 };
  }
  const sec = Math.floor(ms / 1000);
  const days = Math.floor(sec / 86400);
  const hours = Math.floor((sec % 86400) / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  const seconds = sec % 60;
  return { days, hours, minutes, seconds };
}

function fmtInt(n) {
  return Math.round(n).toLocaleString("ru-RU");
}

const FOOTNOTE_PHRASE_STORAGE_KEY_V1 = "genurok_exam_footnote_comparison_v1";
const FOOTNOTE_SEED_STORAGE_KEY = "genurok_exam_footnote_hourly_v1";

/**
 * Сравнения по оставшимся секундам (числа пересчитываются от таймера).
 * У каждого браузера свой seed в localStorage; тип фразы — от seed + локального часа.
 */
const COMPARISON_FACTORIES = [
  (sec) =>
    `это как ${fmtInt(sec * (17 / 60))} раз моргнуть`,
  (sec) =>
    `это как посмотреть ${fmtInt(Math.floor(sec / 34))} коротких роликов подряд`,
  (sec) =>
    `это как ${(sec / 3600).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} часов непрерывно болтать с друзьями`,
  (sec) =>
    `это как прослушать ${fmtInt(Math.floor(sec / 210))} песен Вани Дмитриенко подряд`,
  (sec) =>
    `это как непрерывно варить макароны ${fmtInt(Math.floor(sec / 600))} раз по 10 мин`,
  (sec) =>
    `это как пройти ${fmtInt((sec / 3600) * 5)} км без остановки пешком`,
  (sec) =>
    `это как прочитать примерно ${fmtInt(Math.floor(sec / 150))} страниц книги`,
  (sec) =>
    `это как вскипятить чайник ${fmtInt(Math.floor(sec / 420))} раз подряд`,
  (sec) =>
    `это как ${fmtInt(Math.floor(sec / 120))} двухминутных чисток зубов подряд`,
  (sec) =>
    `это как сделать ${fmtInt(Math.floor(sec / 45))} подходов планки по 45 секунд`,
  (sec) =>
    `это как написать «ну как ты?» ${fmtInt(Math.floor(sec / 5))} раз`,
  (sec) =>
    `это как сыграть ${fmtInt(Math.floor(sec / ( 3600)))} раз (по 2 часа) в Симс`,
  (sec) =>
    `это как посмотреть ${fmtInt(Math.floor(sec / (22 * 60)))} серий Рика и Морти`,
];

/** Уникальное целое на каждый локальный календарный час устройства. */
function localHourBucketFromMs(ms) {
  const t = new Date(ms);
  return (
    t.getFullYear() * 1_000_000 +
    (t.getMonth() + 1) * 10_000 +
    t.getDate() * 100 +
    t.getHours()
  );
}

function phraseIndexFromSeed(userSeed, hourBucket, cardSlot) {
  const n = COMPARISON_FACTORIES.length;
  let idx = (userSeed + hourBucket * 31 + cardSlot * 17) % n;
  if (idx < 0) idx += n;
  return idx;
}

function loadOrCreateUserFootnoteSeed() {
  try {
    const raw = localStorage.getItem(FOOTNOTE_SEED_STORAGE_KEY);
    if (raw) {
      const o = JSON.parse(raw);
      const s = Number(o.seed);
      if (Number.isInteger(s) && s > 0) return s;
    }
  } catch {
    /* ignore */
  }
  const seed = 1 + Math.floor(Math.random() * 999_999_999);
  try {
    localStorage.setItem(FOOTNOTE_SEED_STORAGE_KEY, JSON.stringify({ seed }));
    localStorage.removeItem(FOOTNOTE_PHRASE_STORAGE_KEY_V1);
  } catch {
    /* приватный режим и т.п. */
  }
  return seed;
}

function footnoteTextFor(secTotal, phraseIndex) {
  if (secTotal <= 0) {
    return "Экзамен уже идёт или прошёл — удачи на полях сражения с вариантом.";
  }
  const idx = ((phraseIndex % COMPARISON_FACTORIES.length) + COMPARISON_FACTORIES.length) %
    COMPARISON_FACTORIES.length;
  return COMPARISON_FACTORIES[idx](secTotal);
}

const CONFIG = {
  ege: {
    math: { subject: "Математика", dateLine: "8 июня · 10:00" },
    inf: { subject: "Информатика", dateLine: "18 июня · 10:00" },
  },
  oge: {
    math: { subject: "Математика", dateLine: "2 июня · 10:00" },
    inf: { subject: "Информатика", dateLine: "6 июня · 10:00" },
  },
};

const COUNTDOWN_HEADLINE = "До экзамена осталось";

function CountdownCard({ subject, dateLine, targetTs, accent, now, levelLabel, footnotePhraseIndex }) {
  const remainMs = targetTs - now;
  const { days, hours, minutes, seconds } = splitRemain(remainMs);
  const secTotal = Math.max(0, Math.floor(remainMs / 1000));
  const parts = [
    { value: days, label: "дн" },
    { value: pad2(hours), label: "час" },
    { value: pad2(minutes), label: "мин" },
    { value: pad2(seconds), label: "сек" },
  ];

  const footnote = footnoteTextFor(secTotal, footnotePhraseIndex);

  return (
    <div
      className={`subject-exam-countdown-card subject-exam-countdown-card--${accent}`}
      role="timer"
      aria-label={`${subject}, ${levelLabel}, экзамен ${dateLine}. ${COUNTDOWN_HEADLINE}`}
    >
      <div className="subject-exam-countdown-card__head">
        <span className="subject-exam-countdown-card__badge">{subject}</span>
        <p className="subject-exam-countdown-card__date">{dateLine}</p>
        <h3 className="subject-exam-countdown-card__title">{COUNTDOWN_HEADLINE}</h3>
      </div>
      <div className="subject-exam-countdown-card__grid">
        {parts.map((p) => (
          <div key={p.label} className="subject-exam-countdown-card__cell">
            <span className="subject-exam-countdown-card__value">{p.value}</span>
            <span className="subject-exam-countdown-card__unit">{p.label}</span>
          </div>
        ))}
      </div>
      <p className="subject-exam-countdown-card__footnote" role="note">
        <span className="subject-exam-countdown-card__footnote-mark" aria-hidden="true">
          *
        </span>
        <span className="subject-exam-countdown-card__footnote-text">{footnote}</span>
      </p>
    </div>
  );
}

export default function SubjectExamCountdowns({ level }) {
  const [now, setNow] = useState(() => Date.now());
  const [footnoteSeed] = useState(loadOrCreateUserFootnoteSeed);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  if (level !== "ege" && level !== "oge") return null;

  const cfg = CONFIG[level];
  const levelLabel = level === "ege" ? "ЕГЭ" : "ОГЭ";
  const mathTarget = getNextExamTimestamp(level, "math");
  const infTarget = getNextExamTimestamp(level, "inf");
  const hourBucket = localHourBucketFromMs(now);
  const mathPhraseIndex = phraseIndexFromSeed(footnoteSeed, hourBucket, 0);
  const infPhraseIndex = phraseIndexFromSeed(footnoteSeed, hourBucket, 1);

  return (
    <div className="subject-exam-countdowns">
      <CountdownCard
        subject={cfg.math.subject}
        dateLine={cfg.math.dateLine}
        targetTs={mathTarget}
        accent="math"
        now={now}
        levelLabel={levelLabel}
        footnotePhraseIndex={mathPhraseIndex}
      />
      <CountdownCard
        subject={cfg.inf.subject}
        dateLine={cfg.inf.dateLine}
        targetTs={infTarget}
        accent="inf"
        now={now}
        levelLabel={levelLabel}
        footnotePhraseIndex={infPhraseIndex}
      />
    </div>
  );
}
