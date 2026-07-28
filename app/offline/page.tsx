export const metadata = { title: "Offline · REF 2026" };

export default function OfflinePage() {
  return (
    <div className="shell">
      <div className="empty" style={{ marginTop: 80 }}>
        <h1 className="band-title" style={{ marginBottom: 12 }}>
          You&apos;re offline
        </h1>
        <p>
          This page isn&apos;t saved for offline use yet. Pages you visit while
          online stay available without a connection.
        </p>
        <p style={{ marginTop: 16 }}>
          <a href="/" className="backlink">
            ← Back to the timetable
          </a>
        </p>
      </div>
    </div>
  );
}
