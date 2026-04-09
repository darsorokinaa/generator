import Dashboard from './Dashboard';
import CallPage from './CallPage';

function App() {
  const path = window.location.pathname;
  // CallPage рендерится вне StrictMode — иначе WS/PC пересоздаются дважды
  if (path.startsWith('/call')) return <CallPage />;
  return <Dashboard />;
}

export default App;
