import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { runBatch, type Database } from "@/server/db/client";
import { siteSettings } from "@/server/db/schema";
import { normalizeIraqiPhone } from "@/lib/phone";
import { DEPOSIT_METHODS, type DepositMethod } from "@/lib/domain";
import { auditInsert, type AuditActor } from "./audit";

const localized = (max: number) => z.object({ en: z.string().trim().max(max), ar: z.string().trim().max(max) });
const optionalPhone = z
  .string()
  .trim()
  .max(24)
  .transform((v, ctx) => {
    if (!v) return "";
    const p = normalizeIraqiPhone(v);
    if (!p) {
      ctx.addIssue({ code: "custom", message: "invalid_phone" });
      return z.NEVER;
    }
    return p;
  });
const httpsUrl = z
  .string()
  .trim()
  .max(200)
  .refine((v) => v === "" || /^https:\/\/[^\s<>"']+$/.test(v), "invalid_url");

export const settingSchemas = {
  // Email, phone numbers and working hours are fixed in lib/business.ts.
  store: z.object({
    whatsapp: optionalPhone,
    instagram: httpsUrl,
    facebook: httpsUrl,
    address: localized(200),
  }),
  homepage: z.object({
    announcement: localized(160),
    heroTitle: localized(90),
    heroSubtitle: localized(240),
  }),
  customPrint: z.object({
    materials: z.array(z.object({ code: z.string().regex(/^[A-Z0-9_-]{2,20}$/), en: z.string().trim().min(1).max(40), ar: z.string().trim().min(1).max(40) })).min(1).max(20),
    colors: z.array(z.object({ code: z.string().regex(/^[A-Z0-9_-]{2,20}$/), en: z.string().trim().min(1).max(40), ar: z.string().trim().min(1).max(40) })).min(1).max(40),
  }),
  payments: z.object({
    /**
     * Manual transfer verification is a TEMPORARY fallback while no online
     * provider is connected. It only works after an OWNER approves it; the
     * approval (who and when) is stored here and in the audit log.
     */
    manualFallback: z
      .object({ approved: z.boolean(), approvedBy: z.string().max(80).nullable(), approvedAt: z.string().max(40).nullable() })
      .default({ approved: false, approvedBy: null, approvedAt: null }),
    methods: z.object(
      Object.fromEntries(
        DEPOSIT_METHODS.map((m) => [m, z.object({ enabled: z.boolean(), instructions: localized(600) })]),
      ) as Record<DepositMethod, z.ZodObject<{ enabled: z.ZodBoolean; instructions: ReturnType<typeof localized> }>>,
    ),
  }),
  security: z.object({
    /** When true, every admin role must use TOTP (Super Admins always must). */
    requireTotpForAllAdmins: z.boolean(),
  }),
} as const;

export type SettingKey = keyof typeof settingSchemas;
export type Settings = { [K in SettingKey]: z.infer<(typeof settingSchemas)[K]> };

export const DEFAULT_SETTINGS: Settings = {
  store: {
    whatsapp: "",
    instagram: "",
    facebook: "",
    address: { en: "", ar: "" },
  },
  homepage: {
    announcement: { en: "Flat 5,000 IQD delivery · Cash on delivery", ar: "توصيل بسعر ثابت ٥٬٠٠٠ دينار · الدفع عند الاستلام" },
    heroTitle: { en: "Engineered prints, made for you.", ar: "طباعة ثلاثية الأبعاد بدقة هندسية، مسوّاة إلك." },
    heroSubtitle: {
      en: "Robotics parts, tools, figurines and fully custom prints. We design and print them in our own workshop and deliver them to your door.",
      ar: "قطع روبوتات، أدوات، مجسمات وطباعة حسب الطلب. نصممها ونطبعها بورشتنا ونوصلها لباب بيتك.",
    },
  },
  customPrint: {
    materials: [
      { code: "PLA", en: "PLA (standard)", ar: "PLA (عادي)" },
      { code: "PETG", en: "PETG (tough, heat-resistant)", ar: "PETG (قوي ويتحمل حرارة)" },
      { code: "ABS", en: "ABS (engineering)", ar: "ABS (هندسي)" },
      { code: "TPU", en: "TPU (flexible)", ar: "TPU (مرن)" },
      { code: "RESIN", en: "Resin (high detail)", ar: "ريزن (تفاصيل دقيقة)" },
    ],
    colors: [
      { code: "BLACK", en: "Black", ar: "أسود" },
      { code: "WHITE", en: "White", ar: "أبيض" },
      { code: "GREY", en: "Grey", ar: "رصاصي" },
      { code: "PURPLE", en: "Purple", ar: "بنفسجي" },
      { code: "RED", en: "Red", ar: "أحمر" },
      { code: "BLUE", en: "Blue", ar: "أزرق" },
      { code: "ANY", en: "Your recommendation", ar: "حسب اقتراحكم" },
    ],
  },
  payments: {
    manualFallback: { approved: false, approvedBy: null, approvedAt: null },
    methods: {
      FIB: { enabled: false, instructions: { en: "", ar: "" } },
      QICARD: { enabled: false, instructions: { en: "", ar: "" } },
      ZAINCASH: { enabled: false, instructions: { en: "", ar: "" } },
    },
  },
  security: { requireTotpForAllAdmins: false },
};

export async function getSettings<K extends SettingKey>(db: Database, keys: K[]): Promise<Pick<Settings, K>> {
  const rows = await db.select().from(siteSettings).where(inArray(siteSettings.key, keys));
  const out = {} as Pick<Settings, K>;
  for (const key of keys) {
    const row = rows.find((r) => r.key === key);
    const parsed = row ? settingSchemas[key].safeParse(row.value) : null;
    out[key] = (parsed?.success ? parsed.data : DEFAULT_SETTINGS[key]) as Settings[K];
  }
  return out;
}

export async function getSetting<K extends SettingKey>(db: Database, key: K): Promise<Settings[K]> {
  return (await getSettings(db, [key]))[key];
}

export async function saveSetting<K extends SettingKey>(db: Database, key: K, raw: unknown, actor: AuditActor) {
  const parsed = settingSchemas[key].safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: "invalid_input" as const, issues: parsed.error.issues.map((i) => i.path.join(".")) };
  await runBatch(db, [
    db
      .insert(siteSettings)
      .values({ key, value: parsed.data, updatedBy: actor.adminId })
      .onConflictDoUpdate({ target: siteSettings.key, set: { value: parsed.data, updatedBy: actor.adminId, updatedAt: new Date() } }),
    auditInsert(db, actor, { action: `settings.${key}.updated`, targetType: "setting", targetId: key }),
  ]);
  return { ok: true as const };
}

export async function hasSetting(db: Database, key: SettingKey) {
  return (await db.select({ key: siteSettings.key }).from(siteSettings).where(eq(siteSettings.key, key)).limit(1)).length > 0;
}
