import Dashboard from './Dashboard';
import CallPage from './CallPage';
import VariantPlayPage from './VariantPlayPage';

function App() {
  const path = window.location.pathname;
  // CallPage рендерится вне StrictMode — иначе WS/PC пересоздаются дважды
  if (path.startsWith('/call')) return <CallPage />;

  const variantPlayId = new URLSearchParams(window.location.search).get('variant_play');
  if (variantPlayId) return <VariantPlayPage assignmentId={variantPlayId} />;

  return <Dashboard />;
}

export default App;
