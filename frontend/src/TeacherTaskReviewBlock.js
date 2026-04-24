import { useState, useEffect, useCallback, useRef } from 'react';

function CheckIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

/**
 * Блок проверки учителя под карточкой задания (части 1 и 2, режим ДЗ).
 * verdict: 'correct' | 'wrong' | 'empty' | 'pending' | 'scored' (часть 2 — выбран критерий)
 */
export default function TeacherTaskReviewBlock({
  taskNum,
  verdict,
  referenceDisplay,
  studentDisplay,
  initialComment = '',
  onSaveComment,
  onReturnTask,
  /** Задание отмечено на возврат (родитель: revisionPickSet) */
  markedForReturn = false,
  saveBusy = false,
  /** Файлы/фото к ответу ученика (рендерит родитель) */
  attachments = null,
}) {
  const [comment, setComment] = useState(initialComment);
  const [hintShow, setHintShow] = useState(false);
  const [saveLabel, setSaveLabel] = useState('Сохранить');
  const [savePhase, setSavePhase] = useState('idle');
  const saveTimerRef = useRef(null);
  const taId = `tb-comment-${String(taskNum)}`;

  useEffect(() => {
    setComment(initialComment || '');
  }, [initialComment]);

  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
  }, []);

  const isEmpty = verdict === 'empty';

  const handleReturn = useCallback(() => {
    onReturnTask?.();
  }, [onReturnTask]);

  const handleSave = useCallback(async () => {
    if (savePhase !== 'idle' || !onSaveComment) return;
    setHintShow(true);
    setSaveLabel('Сохранено');
    setSavePhase('saved');
    try {
      await onSaveComment(comment);
    } catch {
      setHintShow(false);
      setSaveLabel('Сохранить');
      setSavePhase('idle');
      return;
    }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      setHintShow(false);
      setSaveLabel('Сохранить');
      setSavePhase('idle');
      saveTimerRef.current = null;
    }, 2000);
  }, [comment, onSaveComment, savePhase]);

  const statusCls = verdict === 'correct' || verdict === 'scored'
    ? 'tb-status--correct'
    : verdict === 'partial'
      ? 'tb-status--partial'
    : verdict === 'wrong'
      ? 'tb-status--wrong'
      : verdict === 'pending'
        ? 'tb-status--pending'
        : 'tb-status--empty';
  const statusLabel = verdict === 'correct'
    ? 'Верно'
    : verdict === 'scored'
      ? 'Оценено'
      : verdict === 'partial'
        ? 'Частично верно'
      : verdict === 'wrong'
        ? 'Неверно'
        : verdict === 'pending'
          ? 'Без автопроверки'
          : 'Нет ответа';

  const studentChipCls = verdict === 'correct' || verdict === 'scored'
    ? 'tb-chip tb-chip--answer-correct'
    : verdict === 'partial'
      ? 'tb-chip tb-chip--answer-partial'
    : verdict === 'wrong'
      ? 'tb-chip tb-chip--answer-wrong'
      : verdict === 'pending'
        ? 'tb-chip tb-chip--answer-pending'
        : 'tb-chip tb-chip--answer-empty';

  return (
    <div className="teacher-block">
      <div className="tb-verdict">
        <div className="tb-verdict-left">
          <div className={`tb-status ${statusCls}`}>
            <span className="tb-status-dot" />
            <span className="tb-status-label">{statusLabel}</span>
          </div>
          <div className="tb-chips">
            <span className="tb-chip tb-chip--ref">
              эталон
              {' '}
              {referenceDisplay || '—'}
            </span>
            {!isEmpty && (
              <>
                <span className="tb-chip-arrow">→</span>
                <span className={studentChipCls}>
                  ответ
                  {' '}
                  {studentDisplay || '—'}
                </span>
              </>
            )}
          </div>
        </div>
        <button
          type="button"
          className={`tb-return${!onReturnTask ? ' tb-return--unavailable' : ''}${markedForReturn ? ' tb-return--done' : ''}`}
          disabled={!onReturnTask}
          aria-pressed={markedForReturn}
          onClick={handleReturn}
        >
          <span
            className={`tb-return-checkbox${markedForReturn ? ' tb-return-checkbox--checked' : ''}`}
            aria-hidden
          >
            {markedForReturn ? (
              <svg className="tb-return-checkbox-tick" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : null}
          </span>
          {markedForReturn ? 'Снять с доработки' : 'Вернуть'}
        </button>
      </div>
      {attachments ? (
        <div className="tb-attachments">
          {attachments}
        </div>
      ) : null}
      <div className="tb-comment">
        <label className="tb-comment-label" htmlFor={taId}>
          Комментарий ученику
        </label>
        <textarea
          id={taId}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Текст для ученика…"
          disabled={saveBusy}
        />
        <div className="tb-actions">
          <span className={`tb-save-hint${hintShow ? ' show' : ''}`}>
            <CheckIcon size={14} />
            Сохранено
          </span>
          <button
            type="button"
            className={`tb-save-btn${savePhase === 'saved' ? ' tb-save-btn--saved' : ''}`}
            disabled={saveBusy}
            onClick={handleSave}
          >
            {saveBusy ? '…' : saveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
