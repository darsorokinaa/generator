import { createRoot } from "react-dom/client";
import { JitsiMeeting } from "@jitsi/react-sdk";

function LessonJitsiSpinner() {
  return (
    <div className="lesson-jitsi-spinner">Подключение к видеозвонку…</div>
  );
}

function readProps() {
  const el = document.getElementById("lesson-jitsi-props");
  if (!el?.textContent) return null;
  try {
    return JSON.parse(el.textContent);
  } catch {
    return null;
  }
}

const props = readProps();
const mount = document.getElementById("lesson-jitsi-root");

if (props?.domain && props?.roomName && mount) {
  const root = createRoot(mount);
  root.render(
    <JitsiMeeting
      domain={props.domain}
      roomName={props.roomName}
      jwt={props.jwt || undefined}
      userInfo={{
        displayName: props.displayName || "Участник",
      }}
      configOverwrite={{
        disableDeepLinking: true,
        prejoinConfig: { enabled: false },
      }}
      spinner={LessonJitsiSpinner}
    />
  );
}
