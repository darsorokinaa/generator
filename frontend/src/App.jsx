import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";

import Layout from "./pages/Layout";
import IndexPage from "./pages/IndexPage";
import SubjectPage from "./pages/SubjectPage";
import TasksPage from "./pages/TasksPage";
import ExamPage from "./pages/ExamPage";
import SearchTaskPage from "./pages/SearchTaskPage";
import SearchVariantPage from "./pages/SearchVariantPage";

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
      <Routes>

        <Route element={<Layout />}>

          <Route path="/" element={<IndexPage />} />

          <Route path="/search/tasks" element={<SearchTaskWithKey />} />
          <Route path="/search-variant" element={<SearchVariantWithKey />} />

          <Route path="/:level" element={<SubjectPage />} />

          <Route path="/:level/:subject" element={<TasksPage />} />

          <Route
            path="/:level/:subject/variant/:variant_id"
            element={<ExamPage />}
          />

        </Route>

      </Routes>
    </BrowserRouter>
  );
}

export default App;
