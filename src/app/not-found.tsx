import Link from "next/link";

// Only reached for paths outside /ar and /en that the locale proxy could not
// redirect (e.g. malformed URLs). Localized 404s live in app/[locale].
export default function RootNotFound() {
  return (
    <html lang="ar" dir="rtl">
      <body>
        <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", textAlign: "center", padding: 24 }}>
          <div>
            <h1 style={{ fontSize: 28, marginBottom: 12 }}>404</h1>
            <p style={{ marginBottom: 16 }}>الصفحة غير موجودة · Page not found</p>
            <Link href="/ar" style={{ textDecoration: "underline" }}>
              الرئيسية
            </Link>
            {" · "}
            <Link href="/en" style={{ textDecoration: "underline" }}>
              Home
            </Link>
          </div>
        </main>
      </body>
    </html>
  );
}
