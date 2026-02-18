import { useNavigate } from "react-router-dom";

function IndexPage() {
  const navigate = useNavigate();

  return (
    <div>

      <div className="hero">
        <h1>Добро пожаловать!</h1>
        <p>
          Начните подготовку к экзаменам прямо сейчас.
          Выберите нужный формат и достигайте отличных результатов вместе с нами.
        </p>
      </div>

      <div className="exam-grid">

        <div
          className="exam-card exam-card-oge"
          onClick={() => navigate("/oge")}
          style={{ cursor: "pointer" }}
        >
          <div className="exam-icon">📝</div>
          <h3 className="exam-title">ОГЭ</h3>
          <p className="exam-description">
            Основной государственный экзамен для 9 класса
          </p>
          <div className="exam-footer">
            <span className="exam-badge">9 класс</span>
            <span className="exam-arrow">→</span>
          </div>
        </div>

        <div
          className="exam-card exam-card-ege"
          onClick={() => navigate("/ege")}
          style={{ cursor: "pointer" }}
        >
          <div className="exam-icon">🎓</div>
          <h3 className="exam-title">ЕГЭ</h3>
          <p className="exam-description">
            Единый государственный экзамен для 11 класса
          </p>
          <div className="exam-footer">
            <span className="exam-badge">11 класс</span>
            <span className="exam-arrow">→</span>
          </div>
        </div>

      </div>

    </div>
  );
}

export default IndexPage;
