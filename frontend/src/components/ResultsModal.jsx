import { useEffect, useState } from "react";
import StudentNameModal from "./StudentNameModal";

/**
 * Модальное окно с результатами выполнения варианта.
 */
export default function ResultsModal({ open, onClose, results }) {
  const [studentNameModalOpen, setStudentNameModalOpen] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  const formatLocalDate = (d) => {
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    return `${day}.${month}.${d.getFullYear()}`;
  };
  const formatLocalTime = (d) => {
    return [d.getHours(), d.getMinutes(), d.getSeconds()]
      .map((n) => String(n).padStart(2, "0"))
      .join(":");
  };

  const handleDownloadReport = async (studentName) => {
    if (!results || reportLoading) return;
    setReportLoading(true);
    try {
      const startDate = results.startTime ? new Date(results.startTime) : null;
      const endDate = results.endTime ? new Date(results.endTime) : null;
      const payload = {
        studentName,
        variantId: results.variantId,
        startTime: results.startTime,
        endTime: results.endTime,
        dateSolutionLocal: startDate ? formatLocalDate(startDate) : "",
        timeStartLocal: startDate ? formatLocalTime(startDate) : "",
        timeEndLocal: endDate ? formatLocalTime(endDate) : "",
        totalTimeFormatted: results.totalTimeFormatted,
        taskTimes: results.taskTimes,
        checkedTasks: results.checkedTasks,
        scores: results.scores,
        totalScore: results.totalScore,
        maxScore: results.maxScore,
        scoreExam: results.scoreExam,
        scoreComment: results.scoreComment,
        markLevel: results.markLevel,
        tasks: results.tasks,
      };
      const res = await fetch(
        `/api/${results.level}/${results.subject}/report-pdf/`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify(payload),
        }
      );
      if (!res.ok) throw new Error("Ошибка загрузки отчёта");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `report-${studentName.replace(/\s+/g, "-") || "report"}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) {
      console.error(err);
      alert("Не удалось скачать отчёт. Попробуйте позже.");
    } finally {
      setReportLoading(false);
    }
  };

  if (!open || !results) return null;

  const { totalTimeFormatted, taskTimes, totalScore, maxScore, scoreExam, scoreComment, markLevel, tasks, level } = results;
  const levelToClass = { 1: "insufficient", 2: "threshold", 3: "average", 4: "high" };
  const scoreLevelClass = markLevel && levelToClass[markLevel] ? `results-score-${levelToClass[markLevel]}` : "";
  const taskIdToNumber = tasks?.reduce((acc, t) => ({ ...acc, [t.id]: t.number }), {}) ?? {};

  const CONFETTI_COLORS = [
    "#f59e0b", "#ef4444", "#ec4899", "#8b5cf6",
    "#3b82f6", "#06b6d4", "#10b981", "#84cc16",
    "#f97316", "#eab308", "#14b8a6",
  ];
  const rand = (i, seed) => ((i * 7 + seed) % 11) / 11;
  const edgePositions = [
    ...[[5, 0], [15, 0], [25, 0], [40, 0], [50, 0], [60, 0], [75, 0], [85, 0], [95, 0]].map(([x, y], i) => ({ left: x, top: y, dx: (rand(i, 1) - 0.5) * 2.2, dy: -1.2 })),
    ...[[5, 100], [15, 100], [25, 100], [40, 100], [50, 100], [60, 100], [75, 100], [85, 100], [95, 100]].map(([x, y], i) => ({ left: x, top: y, dx: (rand(i + 5, 2) - 0.5) * 2.2, dy: 1.2 })),
    ...[[0, 15], [0, 35], [0, 50], [0, 65], [0, 85]].map(([x, y], i) => ({ left: x, top: y, dx: -1.2, dy: (rand(i + 10, 3) - 0.5) * 2.2 })),
    ...[[100, 15], [100, 35], [100, 50], [100, 65], [100, 85]].map(([x, y], i) => ({ left: x, top: y, dx: 1.2, dy: (rand(i + 15, 4) - 0.5) * 2.2 })),
  ];
  const confettiPieces = edgePositions.map((p, i) => ({
    ...p,
    delay: (i * 0.02) % 0.5,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    size: 10 + (i % 5),
  }));

  return (
    <div className="results-modal-overlay" onClick={onClose}>
      <div className="results-modal-wrapper">
        <div className="confetti-around-modal" aria-hidden="true">
          {confettiPieces.map((p, i) => (
            <span
              key={i}
              className="confetti-piece confetti-piece-burst"
              style={{
                left: `${p.left}%`,
                top: `${p.top}%`,
                animationDelay: `${p.delay}s`,
                backgroundColor: p.color,
                width: p.size,
                height: p.size * 0.6,
                ["--burst-x"]: `${p.dx * 140}px`,
                ["--burst-y"]: `${p.dy * 140}px`,
              }}
            />
          ))}
        </div>
        <div className="results-modal-window" onClick={(e) => e.stopPropagation()}>
        <div className="results-modal-header">
          <h3 className="results-modal-title">Результаты</h3>
          <button
            type="button"
            className="results-modal-close"
            onClick={onClose}
            aria-label="Закрыть"
          >
            ×
          </button>
        </div>
        <div className="results-modal-body">
          <div className="results-row results-row-no-border">
            <span className="results-label">Время решения:</span>
            <span className="results-value">{totalTimeFormatted}</span>
          </div>

          {taskTimes && Object.keys(taskTimes).length > 0 && (() => {
            const sorted = Object.entries(taskTimes).sort(([a], [b]) => (taskIdToNumber[a] ?? 0) - (taskIdToNumber[b] ?? 0));
            const mid = Math.ceil(sorted.length / 2);
            const col1 = sorted.slice(0, mid);
            const col2 = sorted.slice(mid);
            const renderTable = (rows) => (
              <table className="results-task-times-table">
                <thead>
                  <tr>
                    <th>Задание</th>
                    <th>Время</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(([taskId, seconds]) => (
                    <tr key={taskId}>
                      <td>{taskIdToNumber[taskId] ?? taskId}</td>
                      <td>{formatTime(seconds)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            );
            return (
              <div className="results-section">
                <div className="results-section-title">Время по заданиям</div>
                <div className="results-task-times-wrap">
                  <div className="results-task-times-columns">
                    <div className="results-task-times-column">{renderTable(col1)}</div>
                    {col2.length > 0 && <div className="results-task-times-column">{renderTable(col2)}</div>}
                  </div>
                </div>
              </div>
            );
          })()}

          <div className="results-row results-row-primary">
            <span className="results-label">Первичные баллы:</span>
            <span className="results-value">
              {totalScore} из {maxScore}
            </span>
          </div>

          {(scoreExam != null || (scoreComment != null && String(scoreComment).trim() !== "")) && (
          <div className="results-score-exam-block">
            {scoreExam != null && (
              <div className="results-row results-row-primary">
                <span className="results-label">
                  {String(level).toLowerCase() === "oge" ? "Оценка:" : "Вторичные баллы:"}
                </span>
                <span className="results-value">
                  {String(level).toLowerCase() === "oge"
                    ? Number(scoreExam)
                    : `${Number(scoreExam)} из 100`}
                </span>
              </div>
            )}
            {scoreComment != null && String(scoreComment).trim() !== "" && (
              <div className={`results-score-comment ${scoreLevelClass}`}>{scoreComment}</div>
            )}
          </div>
          )}

          <div className="results-download-section">
            <button
              type="button"
              className="exam-fixed-support-btn results-download-btn"
              onClick={() => setStudentNameModalOpen(true)}
              disabled={reportLoading}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              <span>{reportLoading ? "Загрузка…" : "Скачать подробный отчёт"}</span>
            </button>
          </div>
        </div>
      </div>
      </div>
      <StudentNameModal
        open={studentNameModalOpen}
        onClose={() => setStudentNameModalOpen(false)}
        onConfirm={(name) => {
          setStudentNameModalOpen(false);
          handleDownloadReport(name);
        }}
      />
    </div>
  );
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m > 0) return `${m} мин ${s} сек`;
  return `${s} сек`;
}
