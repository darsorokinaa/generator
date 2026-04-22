import Dashboard from './Dashboard';
// import CallPage from './CallPage';
import VariantPlayPage from './VariantPlayPage';
import LessonRoomPage from './LessonRoomPage';
import HomeworkRoomPage from './HomeworkRoomPage';

function App() {
  // Видеозвонки отключены:
  // const path = window.location.pathname;
  // if (path.startsWith('/call')) return <CallPage />;

  const variantPlayId = new URLSearchParams(window.location.search).get('variant_play');
  if (variantPlayId) return <VariantPlayPage assignmentId={variantPlayId} />;

  const homeworkRoomId = new URLSearchParams(window.location.search).get('homework_room');
  if (homeworkRoomId) return <HomeworkRoomPage assignmentId={homeworkRoomId} />;

  const lessonToken = new URLSearchParams(window.location.search).get('lesson_token');
  if (lessonToken) {
    const params = new URLSearchParams(window.location.search);
    return (
      <LessonRoomPage
        token={lessonToken}
        roomId={params.get('lesson_room_id') || ''}
        targetName={params.get('lesson_target') || ''}
        variantId={params.get('lesson_variant_id') || ''}
      />
    );
  }

  return <Dashboard />;
}

export default App;
