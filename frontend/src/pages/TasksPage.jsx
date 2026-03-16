import { useState, useEffect } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";

const SUBJECT_NAMES = { math: "Математика", inf: "Информатика" };

function TasksPage() {
  const { level, subject } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const searchQuery = searchParams.get("search")?.trim() ?? "";
  const subjectName = SUBJECT_NAMES[subject] || subject;

  const [tasks, setTasks] = useState([]);
  const [subjectNameFromApi, setSubjectNameFromApi] = useState(subjectName);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  /** Подтемы для тренажёра: список по номерам заданий */
  const [subtopicsByTask, setSubtopicsByTask] = useState([]);
  /** Выбранные id подтем — при непустом списке в тренажёре только задачи по этим подтемам */
  const [selectedSubtopicIds, setSelectedSubtopicIds] = useState([]);
  /** Подтемы показываются только после клика по номеру задания */
  const [subtopicsPanelOpen, setSubtopicsPanelOpen] = useState(false);
  /** Количество задач по подтеме (id подтемы → число) */
  const [subtopicCounts, setSubtopicCounts] = useState({});

  /** Блок 2: счётчики по task_N / group_N */
  const [testCounts, setTestCounts] = useState({});
  /** Фильтры «Только задачи ФИПИ» */
  const [onlyFipiVariant, setOnlyFipiVariant] = useState(false);
  const [onlyFipiTrainer, setOnlyFipiTrainer] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/${level}/${subject}/subtopics/`)
      .then((res) => (res.ok ? res.json() : { subtopics_by_task: [] }))
      .then((data) => {
        if (!cancelled) setSubtopicsByTask(data.subtopics_by_task || []);
      })
      .catch(() => { if (!cancelled) setSubtopicsByTask([]); });
    return () => { cancelled = true; };
  }, [level, subject]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/${level}/${subject}/tasks/`)
      .then((res) => {
        if (!res.ok) throw new Error(res.statusText);
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        setTasks(data.tasks || []);
        setSubjectNameFromApi(data.subject_name || subjectName);
        setLoading(false);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message || "Ошибка загрузки");
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [level, subject]);

  const matchesSearch = (item) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    if (item.type === "group" || item.type === "linked_group") {
      return (item.tasks || []).some(
        (t) =>
          (/^\d+$/.test(q) && t.task_number === parseInt(q, 10)) ||
          ((t.task_title || "").toLowerCase()).includes(q)
      );
    }
    if (/^\d+$/.test(q) && item.task_number === parseInt(q, 10)) return true;
    return ((item.task_title || "").toLowerCase()).includes(q);
  };

  const getItemPart = (item) =>
    item.type === "group" || item.type === "linked_group"
      ? item.tasks?.[0]?.part
      : item.part;

  // Определяем, есть ли у TaskList задачи автора ФИПИ (по данным подтем)
  const hasFipiForTaskList = (taskListId) => {
    const block = subtopicsByTask.find((b) => b.task_list_id === taskListId);
    if (!block) return false;
    return (block.subtopics || []).some((st) => (st.fipi_task_count ?? 0) > 0);
  };

  // ФИПИ-элемент: у одиночного номера или любой части группы есть хотя бы одна задача ФИПИ
  const isFipiItem = (item) => {
    if (item.type === "linked_group" || item.type === "group") {
      const ids = (item.tasks || []).map((t) => t.tasklist_id).filter(Boolean);
      return ids.some((id) => hasFipiForTaskList(id));
    }
    return hasFipiForTaskList(item.id);
  };

  // Для генерации варианта: при включённом фильтре берём только ФИПИ-элементы
  const tasksForVariant =
    onlyFipiVariant && subtopicsByTask.length > 0 ? tasks.filter(isFipiItem) : tasks;

  // Для тренажёра: фильтр ФИПИ + поиск по номеру/названию
  const tasksForTrainer =
    (onlyFipiTrainer && subtopicsByTask.length > 0 ? tasks.filter(isFipiItem) : tasks).filter(matchesSearch);

  const part1Tasks = tasksForVariant.filter(
    (item) => getItemPart(item) === 1 && matchesSearch(item)
  );
  const part2Tasks = tasksForVariant.filter(
    (item) => getItemPart(item) === 2 && matchesSearch(item)
  );

  const postVariant = (payload, mode = "variant", extra = {}) => {
    const body = JSON.stringify(payload);
    return fetch(`/api/${level}/${subject}/variant/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    })
      .then((res) => {
        if (!res.ok) return res.json().then((d) => { throw new Error(d.error || res.statusText); });
        return res.json();
      })
      .then((data) => {
        navigate(`/${level}/${subject}/variant/${data.variant_id}`, {
          state: { mode, subjectName: subjectNameFromApi, ...extra },
        });
      });
  };

  const payloadFromTasks = (items) => {
    const payload = {};
    items.forEach((item) => {
      if (item.type === "group" && item.tasks?.length) {
        item.tasks.forEach((t) => {
          const tid = t.tasklist_id ?? t.id;
          payload[String(tid)] = 1;
        });
      } else if (item.type === "linked_group" && item.tasks?.length) {
        item.tasks.forEach((t) => {
          payload[String(t.tasklist_id)] = 1;
        });
      } else {
        payload[String(item.id)] = 1;
      }
    });
    return payload;
  };

  const [submitBlock1, setSubmitBlock1] = useState(false);
  const [submitBlock2, setSubmitBlock2] = useState(false);

  const onPart1 = () => {
    const items = onlyFipiVariant
      ? tasks.filter((item) => getItemPart(item) === 1)
      : part1Tasks;
    const payload = {
      content: payloadFromTasks(items),
      ...(onlyFipiVariant ? { only_fipi: true } : {}),
    };
    if (Object.keys(payload.content).length === 0) return;
    setSubmitBlock1(true);
    postVariant(payload, "part1").catch((err) => setError(err.message)).finally(() => setSubmitBlock1(false));
  };
  const onPart2 = () => {
    const items = onlyFipiVariant
      ? tasks.filter((item) => getItemPart(item) === 2)
      : part2Tasks;
    const payload = {
      content: payloadFromTasks(items),
      ...(onlyFipiVariant ? { only_fipi: true } : {}),
    };
    if (Object.keys(payload.content).length === 0) return;
    setSubmitBlock1(true);
    postVariant(payload, "part2").catch((err) => setError(err.message)).finally(() => setSubmitBlock1(false));
  };
  const onChooseAll = () => {
    // Все слоты отправляем всегда; при only_fipi бэкенд сам отфильтрует по ФИПИ по каждому слоту
    const payload = {
      content: payloadFromTasks(tasks),
      ...(onlyFipiVariant ? { only_fipi: true } : {}),
    };
    if (Object.keys(payload.content).length === 0) return;
    setSubmitBlock1(true);
    postVariant(payload, "variant").catch((err) => setError(err.message)).finally(() => setSubmitBlock1(false));
  };

  

  const buildPayloadFromTestCounts = () => {
    const content = {};
    const tasksList = [];
    const itemsById = Object.fromEntries(
      tasks.map((item) => [getIdentifier(item), item])
    );
    const useSubtopicCounts = selectedSubtopicIds.length > 0;
    const c = 1;
    for (const [identifier, count] of Object.entries(testCounts)) {
      if (Number(count) <= 0) continue;
      const item = itemsById[identifier];
      if (!item) continue;
      if (identifier.startsWith("task_")) {
        let slotCount = c;
        if (useSubtopicCounts && subtopicsByTask.length) {
          const block = subtopicsByTask.find((b) => b.task_list_id === item.id);
          if (block?.subtopics) {
            slotCount = block.subtopics
              .filter((st) => selectedSubtopicIds.includes(st.id))
              .reduce((sum, st) => sum + (subtopicCounts[st.id] ?? 0), 0);
          }
        }
        if (slotCount <= 0) continue;
        content[String(item.id)] = slotCount;
        tasksList.push({ tasklist_id: item.id, task_number: item.task_number, count: slotCount });
      } else if (identifier.startsWith("linked_") && item.tasks?.length) {
        const nums = item.task_numbers || item.tasks.map((t) => t.task_number);
        item.tasks.forEach((t) => {
          content[String(t.tasklist_id)] = (content[String(t.tasklist_id)] ?? 0) + c;
        });
        tasksList.push({ task_numbers: nums, count: c });
      } else if (identifier.startsWith("group_") && item.tasks?.length) {
        const nums = item.tasks.map((t) => t.task_number);
        item.tasks.forEach((t) => {
          const tid = t.tasklist_id ?? t.id;
          content[String(tid)] = (content[String(tid)] ?? 0) + c;
        });
        tasksList.push({ task_numbers: nums, count: c });
      }
    }
    const payload = {
      content,
      tasks: tasksList,
      ...(onlyFipiTrainer ? { only_fipi: true } : {}),
    };
    if (useSubtopicCounts) {
      payload.subtopic_ids = selectedSubtopicIds;
      const counts = {};
      selectedSubtopicIds.forEach((id) => {
        const n = subtopicCounts[id] ?? 0;
        if (n > 0) counts[id] = n;
      });
      if (Object.keys(counts).length) payload.subtopic_counts = counts;
    }
    return payload;
  };

  const toggleSubtopic = (subtopicId) => {
    setSelectedSubtopicIds((prev) =>
      prev.includes(subtopicId)
        ? prev.filter((id) => id !== subtopicId)
        : [...prev, subtopicId]
    );
  };

  const changeSubtopicCount = (subtopicId, delta, maxCount) => {
    setSubtopicCounts((prev) => {
      const cur = prev[subtopicId] ?? 0;
      const next = Math.max(0, Math.min(maxCount, cur + delta));
      if (next > 0) {
        setSelectedSubtopicIds((ids) => (ids.includes(subtopicId) ? ids : [...ids, subtopicId]));
      } else {
        setSelectedSubtopicIds((ids) => ids.filter((id) => id !== subtopicId));
      }
      const nextState = { ...prev };
      if (next > 0) nextState[subtopicId] = next;
      else delete nextState[subtopicId];
      return nextState;
    });
  };

  const onStartTest = () => {
    const payload = buildPayloadFromTestCounts();
    if (!payload.tasks?.length) return;
    setSubmitBlock2(true);
    const testTaskLabels = testSelectedIdsSorted.map((id) => identifierToLabel[id] ?? id);
    postVariant(payload, "test", { testTaskLabels })
      .catch((err) => setError(err.message))
      .finally(() => setSubmitBlock2(false));
  };

  const getIdentifier = (item) => {
    if (item.type === "linked_group") return `linked_${item.linked_key}`;
    if (item.type === "group") return `group_${item.group_id}`;
    return `task_${item.id}`;
  };

  const getTestCount = (identifier) => testCounts[identifier] ?? 0;

  const getMaxCount = (item) => {
    if (item.type === "linked_group") return Number(item.count_available) || 0;
    if (item.type === "group") {
      if (!item.tasks?.length) return 0;
      const counts = item.tasks.map((t) => Number(t.count_task) || 0);
      return Math.min(...counts, Infinity);
    }
    return Number(item.count_task) || 0;
  };

  const changeTestCount = (item, delta) => {
    const identifier = getIdentifier(item);
    const max = getMaxCount(item);
    setTestCounts((prev) => {
      const cur = prev[identifier] ?? 0;
      const next = Math.max(0, Math.min(max, cur + delta));
      const nextState = { ...prev };
      if (next > 0) nextState[identifier] = next;
      else delete nextState[identifier];
      return nextState;
    });
  };

  const testTotal = (() => {
    const itemsById = Object.fromEntries(tasks.map((item) => [getIdentifier(item), item]));
    let total = 0;
    const useSubtopicCounts = selectedSubtopicIds.length > 0 && subtopicsByTask.length > 0;
    for (const [identifier, count] of Object.entries(testCounts)) {
      if (Number(count) <= 0) continue;
      const item = itemsById[identifier];
      if (!item) continue;
      if (identifier.startsWith("task_") && useSubtopicCounts) {
        const block = subtopicsByTask.find((b) => b.task_list_id === item.id);
        if (block?.subtopics) {
          block.subtopics
            .filter((st) => selectedSubtopicIds.includes(st.id))
            .forEach((st) => { total += subtopicCounts[st.id] ?? 0; });
        } else {
          total += 1;
        }
      } else {
        total += 1;
      }
    }
    return total;
  })();
  const testSelectedIds = Object.keys(testCounts).filter((id) => (testCounts[id] ?? 0) > 0);

  const getLabel = (item) => {
    if ((item.type === "group" || item.type === "linked_group") && item.tasks?.length) {
      const nums = item.task_numbers || item.tasks.map((t) => t.task_number);
      return `${Math.min(...nums)}–${Math.max(...nums)}`;
    }
    return String(item.task_number ?? item.id);
  };

  const identifierToLabel = Object.fromEntries(
    tasks.map((item) => [getIdentifier(item), getLabel(item)])
  );
  const identifierToSortKey = Object.fromEntries(
    tasks.map((item) => [
      getIdentifier(item),
      (item.type === "group" || item.type === "linked_group") && item.tasks?.length
        ? Math.min(...(item.task_numbers || item.tasks.map((t) => t.task_number)))
        : (item.task_number ?? 0),
    ])
  );
  const testSelectedIdsSorted = [...testSelectedIds].sort(
    (a, b) => (identifierToSortKey[a] ?? 0) - (identifierToSortKey[b] ?? 0)
  );

  const getTaskCountForIdentifier = (identifier) => {
    const item = tasks.find((t) => getIdentifier(t) === identifier);
    if (!item || (testCounts[identifier] ?? 0) <= 0) return 0;
    const useSubtopicCounts = selectedSubtopicIds.length > 0 && subtopicsByTask.length > 0;
    if (identifier.startsWith("task_") && useSubtopicCounts && subtopicsByTask.length) {
      const block = subtopicsByTask.find((b) => b.task_list_id === item.id);
      if (block?.subtopics) {
        return block.subtopics
          .filter((st) => selectedSubtopicIds.includes(st.id))
          .reduce((sum, st) => sum + (subtopicCounts[st.id] ?? 0), 0);
      }
      return 1;
    }
    return 1;
  };

  if (loading) {
    return (
      <div className="container tasks-page">
        <div className="page-header"><h1>{subjectNameFromApi}</h1></div>
        <p>Загрузка заданий…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container tasks-page">
        <div className="page-header"><h1>{subjectNameFromApi}</h1></div>
        <p className="error">{error}</p>
      </div>
    );
  }

  return (
    <div className="container tasks-page">
      <div className="tasks-page-card">
        <h2 className="tasks-page-card-title">Сгенерировать вариант</h2>
        <label className="tasks-page-fipi-toggle">
          <input
            type="checkbox"
            className="tasks-page-subtopic-checkbox-input"
            checked={onlyFipiVariant}
            onChange={(e) => setOnlyFipiVariant(e.target.checked)}
          />
          <span
            className={`tasks-page-subtopic-checkbox-visual ${onlyFipiVariant ? "selected" : ""}`}
            aria-hidden
          />
          <span className="tasks-page-fipi-text">Только задачи ФИПИ</span>
        </label>
        <div className="tasks-page-actions">
          <div className="tasks-page-actions-left">
            <button
              type="button"
              className="add-button part-one"
              onClick={onPart1}
              disabled={submitBlock1 || (subject === "inf" && level === "ege")}
              title={subject === "inf" && level === "ege" ? "Для информатики ЕГЭ доступен только полный вариант" : undefined}
            >
              {submitBlock1 ? "Формируем…" : "Часть 1"}
            </button>
            <button
              type="button"
              className="add-button part-two"
              onClick={onPart2}
              disabled={submitBlock1 || (subject === "inf" && level === "ege")}
              title={subject === "inf" && level === "ege" ? "Для информатики ЕГЭ доступен только полный вариант" : undefined}
            >
              {submitBlock1 ? "Формируем…" : "Часть 2"}
            </button>
            <button type="button" className="add-button full-variant" onClick={onChooseAll} disabled={submitBlock1}>
              {submitBlock1 ? "Формируем…" : "Полный вариант"}
            </button>
          </div>
        </div>
      </div>

      <div className="tasks-page-card">
        <h2 className="tasks-page-card-title">Тренажёр по номерам</h2>
        <label className="tasks-page-fipi-toggle">
          <input
            type="checkbox"
            className="tasks-page-subtopic-checkbox-input"
            checked={onlyFipiTrainer}
            onChange={(e) => setOnlyFipiTrainer(e.target.checked)}
          />
          <span
            className={`tasks-page-subtopic-checkbox-visual ${onlyFipiTrainer ? "selected" : ""}`}
            aria-hidden
          />
          <span className="tasks-page-fipi-text">Только задачи ФИПИ</span>
        </label>
        <div className="tasks-page-test-summary">
          <span className="tasks-page-test-summary-label">Выбраны номера:</span>
          <span className="tasks-page-test-summary-nums">
            {testSelectedIdsSorted.length
              ? testSelectedIdsSorted
                  .map((id) => {
                    const label = identifierToLabel[id] ?? id;
                    const n = getTaskCountForIdentifier(id);
                    const showCount = selectedSubtopicIds.length > 0 && n > 0;
                    return showCount ? `${label} (${n})` : label;
                  })
                  .join(", ")
              : "—"}
          </span>
          <span className="tasks-page-test-summary-count" title="Всего задач">
            {testTotal}
          </span>
        </div>
        <div className="tasks-page-numbers-grid">
          {tasks.map((item) => {
            const identifier = getIdentifier(item);
            const count = getTestCount(identifier);
            const max = getMaxCount(item);
            const label = getLabel(item);
            return (
              <div key={identifier} className="tasks-page-number-cell">
                <button
                  type="button"
                  className={`tasks-page-number-btn ${count > 0 ? "selected" : ""}`}
                  onClick={() => {
                    setSubtopicsPanelOpen(true);
                    if (count === 0 && getMaxCount(item) > 0) changeTestCount(item, 1);
                    else if (count > 0) changeTestCount(item, -1);
                  }}
                  disabled={getMaxCount(item) <= 0}
                  title={count > 0 ? "Убрать из выбора" : "Показать подтемы и добавить в выбор"}
                >
                  {label}
                </button>
              </div>
              );
          })}
        </div>
        {subtopicsPanelOpen && subtopicsByTask.length > 0 && testSelectedIds.length > 0 && (
          <div className="tasks-page-subtopics">
            <div className="tasks-page-subtopics-list tasks-page-subtopics-column">
              {subtopicsByTask.map(({ task_number, task_title, subtopics }) => (
                <div key={task_number} className="tasks-page-subtopics-task">
                  <span className="tasks-page-subtopics-task-label">№{task_number}: {task_title}</span>
                  <div className="tasks-page-subtopics-checkboxes tasks-page-subtopics-col">
                    {(subtopics || []).map((st) => {
                      const maxCount =
                        onlyFipiTrainer && typeof st.fipi_task_count === "number"
                          ? st.fipi_task_count
                          : st.task_count ?? 0;
                      const count = subtopicCounts[st.id] ?? 0;
                      const isChecked = selectedSubtopicIds.includes(st.id);
                      return (
                        <div key={st.id} className="tasks-page-subtopic-row">
                          <label className="tasks-page-subtopic-label">
                            <input
                              type="checkbox"
                              className="tasks-page-subtopic-checkbox-input"
                              checked={isChecked}
                              onChange={() => toggleSubtopic(st.id)}
                            />
                            <span
                              className={`tasks-page-subtopic-checkbox-visual ${isChecked ? "selected" : ""}`}
                              aria-hidden
                            />
                            <span className="tasks-page-subtopic-title">{st.title}</span>
                          </label>
                          <div className="tasks-page-subtopic-counter-wrap">
                            <span
                              className="tasks-page-subtopic-num"
                              title={`Выбрано ${count} из ${maxCount}`}
                            >
                              {count}
                            </span>
                            <span className="tasks-page-subtopic-of">
                              {`из ${maxCount}`}
                            </span>
                            <div className="tasks-page-subtopic-stepper">
                              <button
                                type="button"
                                className="tasks-page-subtopic-step-btn"
                                onClick={() => changeSubtopicCount(st.id, -1, maxCount)}
                                disabled={count <= 0}
                                aria-label="Уменьшить"
                              >
                                −
                              </button>
                              <button
                                type="button"
                                className="tasks-page-subtopic-step-btn"
                                onClick={() => changeSubtopicCount(st.id, 1, maxCount)}
                                disabled={maxCount <= 0 || count >= maxCount}
                                aria-label="Увеличить"
                              >
                                +
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="tasks-page-test-actions">
          <button
            type="button"
            className="add-button clear-selection"
            onClick={() => {
              setTestCounts({});
              setSelectedSubtopicIds([]);
              setSubtopicCounts({});
            }}
          >
            Очистить выбор
          </button>
          <button
            type="button"
            className="add-button primary"
            disabled={testTotal === 0 || submitBlock2}
            onClick={onStartTest}
          >
            {submitBlock2 ? "Запуск…" : "Начать тестирование"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default TasksPage;
