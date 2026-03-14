import { useEffect, useRef, useState } from "react";

const ERROR_TYPES = [
  { id: "typo", label: "Опечатка" },
  { id: "wrong_condition", label: "Неверное условие" },
  { id: "wrong_answer", label: "Не сходится ответ" },
  { id: "other", label: "Другое" },
];

/**
 * Модальное окно для сообщения об ошибке в задании.
 */
export default function ReportErrorModal({ open, onClose, onSubmit, taskNumber }) {
  const [errorType, setErrorType] = useState("");
  const [comment, setComment] = useState("");
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Сброс формы только при открытии (не при каждом ре-рендере родителя)
  useEffect(() => {
    if (open) {
      setErrorType("");
      setComment("");
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  if (!open) return null;

  const [submitting, setSubmitting] = useState(false);
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!errorType) return;
    setSubmitting(true);
    try {
      await onSubmit?.({ errorType, comment: comment.trim() });
      onClose();
    } catch (err) {
      alert(err.message || "Не удалось отправить. Попробуйте позже.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="results-modal-overlay" onClick={onClose}>
      <div className="results-modal-window report-error-modal" onClick={(e) => e.stopPropagation()}>
        <div className="results-modal-header">
          <h3 className="results-modal-title">
            Сообщить об ошибке{taskNumber != null ? ` (задание ${taskNumber})` : ""}
          </h3>
          <button
            type="button"
            className="results-modal-close"
            onClick={onClose}
            aria-label="Закрыть"
          >
            ×
          </button>
        </div>
        <form onSubmit={handleSubmit} className="report-error-form">
          <div className="report-error-field">
            <label className="report-error-label">Тип ошибки</label>
            <div className="report-error-types">
              {ERROR_TYPES.map((t) => (
                <label key={t.id} className="report-error-type-option">
                  <input
                    type="radio"
                    name="errorType"
                    value={t.id}
                    checked={errorType === t.id}
                    onChange={() => setErrorType(t.id)}
                  />
                  <span>{t.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="report-error-field">
            <label htmlFor="report-error-comment" className="report-error-label">
              Комментарий (необязательно)
            </label>
            <textarea
              id="report-error-comment"
              className="report-error-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Опишите ошибку подробнее, если нужно"
              rows={3}
            />
          </div>

          <div className="report-error-actions">
            <button type="button" className="student-name-btn-cancel" onClick={onClose}>
              Отмена
            </button>
            <button
              type="submit"
              className="student-name-btn-ok report-error-submit"
              disabled={!errorType || submitting}
            >
              {submitting ? "Отправка…" : "Отправить"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
