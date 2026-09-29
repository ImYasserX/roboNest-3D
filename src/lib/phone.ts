// Iraqi mobile numbers: 07XX XXX XXXX locally, +964 7XX XXX XXXX internationally.
// Operators use prefixes 075-079 (Korek, Asiacell, Zain, etc.).

const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩";
const EXTENDED_ARABIC_INDIC = "۰۱۲۳۴۵۶۷۸۹";

export function toLatinDigits(value: string): string {
  return value.replace(/[٠-٩۰-۹]/g, (d) => {
    const i = ARABIC_INDIC.indexOf(d);
    return String(i >= 0 ? i : EXTENDED_ARABIC_INDIC.indexOf(d));
  });
}

/** Returns +9647XXXXXXXXX or null if the input is not an Iraqi mobile number. */
export function normalizeIraqiPhone(input: string): string | null {
  const digits = toLatinDigits(input).replace(/[\s\-().]/g, "");
  let national: string | null = null;
  if (/^\+9647\d{9}$/.test(digits)) national = digits.slice(4);
  else if (/^009647\d{9}$/.test(digits)) national = digits.slice(5);
  else if (/^9647\d{9}$/.test(digits)) national = digits.slice(3);
  else if (/^07\d{9}$/.test(digits)) national = digits.slice(1);
  else if (/^7\d{9}$/.test(digits)) national = digits;
  if (!national || !/^7[5-9]\d{8}$/.test(national)) return null;
  return `+964${national}`;
}

/** +9647701234567 → 0770 123 4567 */
export function formatIraqiPhone(e164: string): string {
  if (!/^\+9647\d{9}$/.test(e164)) return e164;
  const local = `0${e164.slice(4)}`;
  return `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`;
}

/** wa.me link for a stored E.164 number. */
export function whatsappLink(e164: string, text?: string): string {
  const base = `https://wa.me/${e164.replace(/^\+/, "")}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}
