import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";

function TasksPage() {

  const { level, subject } = useParams();
  const navigate = useNavigate();

  const [tasks, setTasks] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [subject_name, setSubjectName] = useState("");
  // СТАЛО — ждём и сохраняем токен в state
  const [csrfToken, setCsrfToken] = useState(null);

  useEffect(() => {
    fetch("/api/csrf/", { credentials: "include" })
      .then(res => res.json())
      .then(data => setCsrfToken(data.csrfToken));
  }, []);
  // Загрузка списка заданий
  useEffect(() => {
    fetch(`/api/${level}/${subject}/tasks/`)
      .then(res => res.json())
      .then(data => {
        setTasks(data.tasks);
        setLoading(false);
        setSubjectName(data.subject_name);
      });
  }, [level, subject]);

  const changeCount = (taskId, delta) => {
    setCounts(prev => {
      const newCount = Math.max((prev[taskId] || 0) + delta, 0);
      const updated = { ...prev };

      if (newCount > 0) {
        updated[taskId] = newCount;
      } else {
        delete updated[taskId];
      }

      return updated;
    });
  };

  const selectAll = () => {
    const all = {};
    tasks.forEach(task => {
      all[task.id] = 1;
    });
    setCounts(all);
  };
  const partOne = () => {
    const testPart = {};
    tasks.forEach(task => {
      if (Number(task.part) === 1) {
        testPart[task.id] = 1;
      }
    });
    setCounts(testPart);
  }
  const partTwo = () => {
    const secondPart = {};
    tasks.forEach(task => {
      if (Number(task.part) === 2) {
        secondPart[task.id] = 1;
      }
    });
    setCounts(secondPart);
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0);


  const generateVariant = () => {
  if (Object.keys(counts).length === 0) {
    alert("Пожалуйста, выберите хотя бы одно задание!");
    return;
  }

  fetch(`/api/${level}/${subject}/variant/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": csrfToken  // ← берём из state, не из cookie
    },
    credentials: "include",
    body: JSON.stringify(counts)
  })
    .then(res => res.json())
    .then(data => navigate(`/${level}/${subject}/variant/${data.variant_id}`))
    .catch(() => alert("Ошибка при создании варианта"));
};



  if (loading) return <div>Загрузка...</div>;

  return (
    <div className="container">

      <div className="card">

        <div className="page-header">
          <h1>{subject_name}</h1>
          <h2>Список заданий</h2>
        </div>

        <div className="counter">
          Выбрано задач: <span>{total}</span>
        </div>

       
        <div className="actions">
          <button className="add-button part-one" onClick={partOne}>
            Часть 1
          </button>
          <button className="add-button part-two" onClick={partTwo}>
            Часть 2
          </button>
          <button className="add-button choose-all" onClick={selectAll}>
            Выбрать все
          </button>

          <button className="add-button" onClick={generateVariant}>
            Сформировать вариант
          </button>
        </div>

        <ul className="task-list">
          {tasks.map(task => (
            <li key={task.id} className="task">
              <div className="task-left">
                <div className="controls">
                  <button
                    className="minus"
                    onClick={() => changeCount(task.id, -1)}
                  >
                    −
                  </button>

                  <span className="count">
                    {counts[task.id] || 0}
                  </span>

                  <button
                    className="plus"
                    onClick={() => changeCount(task.id, 1)}
                  >
                    +
                  </button>
                </div>
              </div>

              <div className="task-title">
                {task.task_title}
              </div>
            </li>
          ))}
        </ul>

      </div>

    </div>
  );
}

export default TasksPage;
