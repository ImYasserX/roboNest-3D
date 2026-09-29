// U+2028/U+2029 are built at runtime: the bundler rewrites the escapes in a
// regex literal into raw line terminators, which is a syntax error.
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);

/**
 * Renders Schema.org JSON-LD. `<` is escaped so user-controlled strings
 * (product names etc.) cannot close the script element (XSS).
 */
export function JsonLd({ data }: { data: Record<string, unknown> | Record<string, unknown>[] }) {
  const json = JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .split(LINE_SEPARATOR)
    .join("\\u2028")
    .split(PARAGRAPH_SEPARATOR)
    .join("\\u2029");
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
