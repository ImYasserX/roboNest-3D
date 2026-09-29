// Normalizes English and Arabic text so searches match regardless of case,
// Arabic diacritics, tatweel, or common letter variants (أ/إ/آ → ا, ة → ه,
// ى → ي). Applied both to the stored product search_text and to queries.

export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, "") // harakat, superscript alef, tatweel
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Escapes LIKE wildcards; use with `ESCAPE '\'`. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export function searchTerms(query: string, maxTerms = 6): string[] {
  return normalizeSearchText(query)
    .split(" ")
    .filter((t) => t.length > 0)
    .slice(0, maxTerms);
}
