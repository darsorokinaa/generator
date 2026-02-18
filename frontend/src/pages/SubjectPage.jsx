import { useParams, Link } from "react-router-dom";

function SubjectPage() {
  const { level } = useParams();

  return (
    <div className="container">

      <div className="hero">
        <h1>Выбор предмета</h1>
        <p>
          Выберите предмет для подготовки к экзамену.
          Мы предлагаем качественные материалы для эффективной подготовки.
        </p>
      </div>

      <div className="exam-grid">

        <Link
          to={`/${level}/math`}
          className="exam-card exam-card-math"
        >
          <div className="exam-icon exam-icon-math">🔢</div>
          <h3 className="exam-title">Математика</h3>
          <p className="exam-description">
            Алгебра, геометрия, теория вероятностей и математический анализ
          </p>
          <div className="exam-footer">
            <span className="exam-badge exam-badge-math">Все разделы</span>
            <span className="exam-arrow">→</span>
          </div>
        </Link>

        <Link
          to={`/${level}/inf`}
          className="exam-card exam-card-inf"
        >
          <div className="exam-icon exam-icon-inf">💻</div>
          <h3 className="exam-title">Информатика</h3>
          <p className="exam-description">
            Алгоритмы, программирование, логика и компьютерные системы
          </p>
          <div className="exam-footer">
            <span className="exam-badge exam-badge-inf">Все темы</span>
            <span className="exam-arrow">→</span>
          </div>
        </Link>

      </div>

    </div>
  );
}

export default SubjectPage;
