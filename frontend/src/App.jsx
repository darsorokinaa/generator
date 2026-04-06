import { useEffect, useLayoutEffect } from "react";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";

import Layout from "./pages/Layout";
import IndexPage from "./pages/IndexPage";
import SubjectPage from "./pages/SubjectPage";
import TasksPage from "./pages/TasksPage";
import ExamPage from "./pages/ExamPage";
import SearchTaskPage from "./pages/SearchTaskPage";
import SearchVariantPage from "./pages/SearchVariantPage";
import AuthorsPage from "./pages/AuthorsPage";
import PrivacyPage from "./pages/PrivacyPage";
import NotFoundPage from "./pages/NotFoundPage";
import LessonJoinBridge from "./pages/LessonJoinBridge";

function scrollDocumentToTop() {
  window.scrollTo(0, 0);
  const se = document.scrollingElement;
  if (se) {
    se.scrollTop = 0;
    se.scrollLeft = 0;
  }
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
  const shell = document.querySelector(".app-shell-content");
  if (shell && shell.scrollTop > 0) {
    shell.scrollTop = 0;
  }
}

function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    if ("scrollRestoration" in history) {
      history.scrollRestoration = "manual";
    }
  }, []);

  useLayoutEffect(() => {
    scrollDocumentToTop();
    const id = requestAnimationFrame(() => {
      scrollDocumentToTop();
    });
    return () => cancelAnimationFrame(id);
  }, [pathname]);

  return null;
}

function SearchTaskWithKey() {
  const location = useLocation();
  return <SearchTaskPage key={location.search} />;
}

function SearchVariantWithKey() {
  const location = useLocation();
  return <SearchVariantPage key={location.search} />;
}

function App() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <Routes>

        <Route element={<Layout />}>

          <Route path="/" element={<IndexPage />} />
          <Route path="/about" element={<AuthorsPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />

          <Route path="/search/tasks" element={<SearchTaskWithKey />} />
          <Route path="/search-variant" element={<SearchVariantWithKey />} />

          {/* Иначе /lesson/join матчится как /:level/:subject → «join» и ложная «Ошибка загрузки» */}
          <Route path="/lesson/join" element={<LessonJoinBridge />} />
          <Route path="/lesson/join/" element={<LessonJoinBridge />} />

          <Route path="/:level" element={<SubjectPage />} />

          <Route path="/:level/:subject" element={<TasksPage />} />

          <Route
            path="/:level/:subject/variant/:variant_id"
            element={<ExamPage />}
          />

          <Route path="*" element={<NotFoundPage />} />

        </Route>

      </Routes>
    </BrowserRouter>
  );
}

export default App;
