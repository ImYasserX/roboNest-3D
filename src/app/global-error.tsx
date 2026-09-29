"use client";

// Last-resort boundary (root layout failed). Kept dependency-free and bilingual.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="ar" dir="rtl">
      <body style={{ background: "#0c0a14", color: "#f5f3fb", fontFamily: "system-ui, sans-serif" }}>
        <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", textAlign: "center", padding: 24 }}>
          <div>
            <h1 style={{ fontSize: 26, marginBottom: 12 }}>صار خطأ · Something went wrong</h1>
            <button onClick={reset} style={{ padding: "10px 18px", borderRadius: 8, background: "#7e22ce", color: "#fff", border: 0 }}>
              حاول مرة ثانية · Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
