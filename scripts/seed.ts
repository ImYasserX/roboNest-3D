/**
 * Development seed. Writes into the same local D1/R2 state that `next dev`
 * uses (.wrangler/state). All products are clearly fictional samples; no
 * orders, customers or reviews are created.
 *
 *   npm run db:seed            # refuses if products already exist
 *   npm run db:seed -- --reset # wipes local data first
 *
 * Admin passwords come from SEED_SUPER_ADMIN_PASSWORD / SEED_OPS_ADMIN_PASSWORD
 * or are generated and printed once.
 */
import { getPlatformProxy } from "wrangler";
import { sql } from "drizzle-orm";
import { createDb, type Database } from "@/server/db/client";
import { adminUsers, categories, deliveryAreas, deliveryZones, discounts, products, users } from "@/server/db/schema";
import { normalizeIraqiPhone } from "@/lib/phone";
import { hashPassword } from "@/server/auth/password";
import { encryptString, randomToken } from "@/server/auth/crypto";
import { addDigitalFile, addProductImage, createProduct, saveOption, saveOptionValue, setPreviewModel, updateImageAlt } from "@/server/services/product-admin";
import { saveSetting, DEFAULT_SETTINGS } from "@/server/services/settings";
import { storageKey } from "@/server/storage/file-rules";
import * as M from "./lib/mesh";
import { toGlb, toStl } from "./lib/formats";
import { renderMesh } from "./lib/render";

const actor = { adminId: null, label: "seed" } as const;
type Rgb = [number, number, number];
const PURPLE: Rgb = [0.55, 0.25, 0.9];
const GREY: Rgb = [0.62, 0.64, 0.7];
const ORANGE: Rgb = [0.95, 0.52, 0.18];
const TEAL: Rgb = [0.18, 0.75, 0.7];
const WHITE: Rgb = [0.9, 0.9, 0.92];
const BLACK: Rgb = [0.22, 0.22, 0.26];

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

const shapes = {
  gear: () => M.merge(M.extrudeStar(M.gearOutline(24, 30, 26), 8), M.translate(M.cylinder(8, 14), [0, 0, 0])),
  bracket: () => M.merge(M.box(60, 4, 30), M.translate(M.box(4, 40, 30), [-28, 0, 0]), M.translate(M.box(20, 4, 30), [-18, 36, 0])),
  chassis: () =>
    M.merge(
      M.box(160, 4, 110),
      ...[[-65, -40], [65, -40], [-65, 40], [65, 40]].map(([x, z]) => M.translate(M.cylinder(5, 22), [x, 4, z])),
      M.translate(M.box(70, 12, 40), [0, 4, 0]),
    ),
  organizer: () => M.merge(M.extrudeStar(M.polygonOutline(6, 50), 70), ...[0, 1, 2].map((i) => M.translate(M.extrudeStar(M.polygonOutline(6, 22), 55 + i * 12), [Math.cos(i * 2.1) * 64, 0, Math.sin(i * 2.1) * 64]))),
  vase: () => M.lathe([[30, 0], [42, 20], [48, 55], [40, 100], [26, 135], [30, 160]], 10),
  headphoneStand: () => M.merge(M.cylinder(55, 10), M.translate(M.box(14, 200, 14), [0, 10, 0]), M.translate(M.box(90, 14, 30), [0, 205, 0])),
  clips: () => M.merge(...[0, 1, 2, 3, 4].map((i) => M.translate(M.lathe([[6, 0], [9, 3], [9, 10], [6, 13]], 24), [i * 24 - 48, 0, 0]))),
  bot: () =>
    M.merge(
      M.translate(M.box(50, 50, 40), [0, 0, 0]),
      M.translate(M.sphere(24), [0, 48, 0]),
      M.translate(M.cylinder(2, 22), [10, 92, 0]),
      M.translate(M.sphere(5), [10, 112, 0]),
      M.translate(M.box(12, 36, 12), [-33, 8, 0]),
      M.translate(M.box(12, 36, 12), [33, 8, 0]),
    ),
  knob: () => M.lathe([[0, 0], [16, 0], [18, 4], [18, 16], [15, 20], [0, 22]], 30),
  gearbox: () =>
    M.merge(
      M.extrudeStar(M.gearOutline(36, 45, 41), 10),
      ...[0, 1, 2].map((i) => M.translate(M.extrudeStar(M.gearOutline(12, 14, 11), 12), [Math.cos((i * Math.PI * 2) / 3) * 24, 10, Math.sin((i * Math.PI * 2) / 3) * 24])),
      M.translate(M.extrudeStar(M.gearOutline(12, 10, 7.5), 14), [0, 10, 0]),
    ),
  egg: () => M.lathe(Array.from({ length: 9 }, (_, i) => {
    const t = (i / 8) * Math.PI;
    return [Math.sin(t) * (34 - i * 1.5), (1 - Math.cos(t)) * 45] as [number, number];
  }), 9),
  planets: () => M.merge(...[[8, -90], [12, -60], [16, -25], [24, 20], [20, 70], [10, 100]].map(([r, x]) => M.translate(M.sphere(r), [x, 0, 0]))),
  spool: () => M.merge(M.cylinder(60, 6), M.translate(M.cylinder(30, 60), [0, 6, 0]), M.translate(M.cylinder(60, 6), [0, 66, 0])),
  cubes: () => M.merge(M.box(20, 20, 20), M.translate(M.box(20, 20, 20), [30, 0, 0]), M.translate(M.box(20, 20, 20), [15, 0, 28])),
  keychain: () => M.merge(M.box(60, 4, 22), M.translate(M.box(52, 3, 14), [2, 4, 0]), M.translate(M.cylinder(6, 4), [-34, 0, 0])),
  plaque: () => M.merge(M.box(150, 6, 100), M.translate(M.extrudeStar(M.polygonOutline(40, 30), 4), [0, 6, 0])),
  gripper: () => M.merge(M.box(60, 20, 40), M.translate(M.box(10, 70, 16), [-22, 20, 0]), M.translate(M.box(10, 70, 16), [22, 20, 0]), M.translate(M.box(18, 10, 16), [-14, 82, 0]), M.translate(M.box(18, 10, 16), [14, 82, 0])),
};
type ShapeName = keyof typeof shapes;

// ---------------------------------------------------------------------------
// Catalog definition
// ---------------------------------------------------------------------------

const CATEGORY_TREE = [
  {
    slug: "3d-models", en: "3D Models", ar: "مجسمات 3D",
    descEn: "Downloadable STL, 3MF and OBJ files of our designs, for printing on your own printer.",
    descAr: "ملفات STL و 3MF و OBJ لتصاميمنا، تنزلها وتطبعها على طابعتك.",
    children: [
      ["figurines", "Figurines", "مجسمات وتماثيل"],
      ["engineering-models", "Engineering", "هندسة"],
      ["robotics-models", "Robotics", "روبوتات"],
      ["tool-models", "Tools", "أدوات"],
      ["decoration-models", "Decorations", "ديكورات"],
      ["educational-models", "Educational", "تعليمية"],
      ["functional-parts", "Functional parts", "قطع وظيفية"],
    ],
  },
  {
    slug: "3d-prints", en: "3D Prints", ar: "طبعات 3D",
    descEn: "Parts, tools and decorations we print in our workshop after you order, in the material and colour you choose.",
    descAr: "قطع وأدوات وديكورات نطبعها بورشتنا بعد طلبك، بالمادة واللون اللي تختاره.",
    children: [
      ["robotics-prints", "Robotics", "روبوتات"],
      ["accessories", "Accessories", "إكسسوارات"],
      ["home", "Home", "للبيت"],
      ["engineering-prints", "Engineering", "هندسة"],
      ["decoration-prints", "Decorations", "ديكورات"],
      ["custom-prints", "Custom", "حسب الطلب"],
    ],
  },
] as const;

type OptionSeed = {
  type: "SELECT" | "RADIO" | "CHECKBOX" | "NUMBER" | "TEXT" | "TEXTAREA" | "FILE";
  en: string;
  ar: string;
  helpEn?: string;
  helpAr?: string;
  required?: boolean;
  priceDelta?: number;
  pricePerUnit?: number;
  min?: number;
  max?: number;
  unitEn?: string;
  unitAr?: string;
  values?: { en: string; ar: string; delta?: number; swatch?: string }[];
};

type ProductSeed = {
  slug: string;
  type: "PHYSICAL" | "DIGITAL" | "PHYSICAL_DIGITAL" | "CUSTOMIZABLE" | "CUSTOM_SERVICE";
  category: string;
  en: string;
  ar: string;
  summaryEn: string;
  summaryAr: string;
  descEn: string;
  descAr: string;
  price: number;
  sale?: number;
  cost?: number;
  availability: "MADE_TO_ORDER" | "IN_STOCK" | "OUT_OF_STOCK" | "PREORDER" | "DIGITAL";
  stock?: number;
  days?: [number, number];
  dims?: [number, number, number];
  grams?: number;
  materials: string[];
  colors?: string[];
  tags: string[];
  features?: [string, string][];
  included?: [string, string][];
  specs?: [string, string, string, string][];
  featured?: boolean;
  shape: ShapeName;
  color: Rgb;
  preview?: boolean;
  digital?: boolean;
  options?: OptionSeed[];
};

const COLOR_VALUES = [
  { en: "Galaxy purple", ar: "بنفسجي", swatch: "#7e22ce" },
  { en: "Matte black", ar: "أسود مطفي", swatch: "#1f1f24" },
  { en: "Arctic white", ar: "أبيض", swatch: "#f2f2f5" },
  { en: "Signal orange", ar: "برتقالي", swatch: "#f97316", delta: 0 },
  { en: "Silk gold", ar: "ذهبي حريري", swatch: "#d4a64a", delta: 2_000 },
];

const PRODUCTS: ProductSeed[] = [
  {
    slug: "spur-gear-module-1", type: "PHYSICAL", category: "engineering-prints", featured: true, preview: true,
    en: "Spur Gear, Module 1", ar: "ترس مستقيم، موديول 1",
    summaryEn: "Sample engineering gear, printed in tough PETG or nylon-like PLA+.", summaryAr: "ترس هندسي تجريبي، يُطبع من PETG القوي أو PLA+.",
    descEn: "A module-1 spur gear for prototypes, educational gear trains and light-duty mechanisms. Printed at 0.12 mm layers with 100% infill on the teeth for strength. Sample listing for development.",
    descAr: "ترس مستقيم موديول 1 للنماذج الأولية والمشاريع التعليمية والآليات الخفيفة. ينطبع بطبقات 0.12 ملم وملء 100% للأسنان حتى يكون قوي. منتج تجريبي للتطوير.",
    price: 12_000, cost: 3_500, availability: "MADE_TO_ORDER", days: [2, 4], dims: [60, 60, 14], grams: 38,
    materials: ["PETG", "PLA+"], colors: ["Black", "Purple"], tags: ["gear", "mechanical", "ترس"], shape: "gear", color: PURPLE,
    features: [["Accurate involute profile", "مقطع أسنان دقيق"], ["6 mm bore, reamable", "فتحة 6 ملم قابلة للتوسيع"]],
    specs: [["Module", "الموديول", "1", "1"], ["Teeth", "عدد الأسنان", "24 / 36 / 48", "24 / 36 / 48"], ["Pressure angle", "زاوية الضغط", "20°", "20°"]],
    options: [
      { type: "RADIO", en: "Material", ar: "المادة", required: true, values: [{ en: "PLA+", ar: "PLA+" }, { en: "PETG", ar: "PETG", delta: 2_000 }] },
      { type: "SELECT", en: "Number of teeth", ar: "عدد الأسنان", required: true, values: [{ en: "24 teeth", ar: "24 سن" }, { en: "36 teeth", ar: "36 سن", delta: 3_000 }, { en: "48 teeth", ar: "48 سن", delta: 6_000 }] },
    ],
  },
  {
    slug: "servo-bracket-mg996r", type: "PHYSICAL", category: "robotics-prints", preview: true,
    en: "Servo Mounting Bracket (MG996R)", ar: "حامل سيرفو (MG996R)",
    summaryEn: "L-bracket for standard-size servos. Ready to ship.", summaryAr: "حامل على شكل L للسيرفوات القياسية. جاهز للشحن.",
    descEn: "Fits MG996R, MG995 and similar standard servos. Slotted holes for M3 hardware. Sample listing for development.",
    descAr: "يركب على MG996R و MG995 والسيرفوات القياسية المشابهة، بفتحات لبراغي M3. منتج تجريبي للتطوير.",
    price: 4_500, cost: 1_200, availability: "IN_STOCK", stock: 25, dims: [60, 40, 30], grams: 14,
    materials: ["PETG"], colors: ["Black"], tags: ["servo", "robot", "سيرفو"], shape: "bracket", color: BLACK,
    included: [["1 × bracket", "حامل واحد"], ["4 × M3 screws", "٤ براغي M3"]],
  },
  {
    slug: "rover-chassis-plate", type: "CUSTOMIZABLE", category: "robotics-prints", featured: true, preview: true,
    en: "Robot Rover Chassis Plate", ar: "قاعدة شاسيه روبوت",
    summaryEn: "Customizable chassis for 4-wheel rover builds, with optional engraving.", summaryAr: "شاسيه قابل للتخصيص لروبوت بأربع عجلات، مع حفر اختياري.",
    descEn: "A rigid base plate with motor standoffs and an electronics bay for Arduino/ESP32 builds. Choose the material, colour and add your team name. Sample listing for development.",
    descAr: "قاعدة متينة بيها قواعد للمواتير ومكان للإلكترونيات لمشاريع Arduino و ESP32. اختار المادة واللون وضيف اسم فريقك. منتج تجريبي للتطوير.",
    price: 28_000, cost: 9_000, availability: "MADE_TO_ORDER", days: [3, 5], dims: [160, 110, 26], grams: 180,
    materials: ["PLA+", "PETG"], colors: ["Purple", "Black", "White"], tags: ["robot", "chassis", "arduino", "روبوت"], shape: "chassis", color: PURPLE,
    features: [["Fits TT gear motors", "يركب عليه مواتير TT"], ["M3 mounting grid", "شبكة فتحات M3"]],
    options: [
      { type: "SELECT", en: "Colour", ar: "اللون", required: true, values: COLOR_VALUES },
      { type: "RADIO", en: "Material", ar: "المادة", required: true, values: [{ en: "PLA+", ar: "PLA+" }, { en: "PETG (stronger)", ar: "PETG (أقوى)", delta: 4_000 }] },
      { type: "TEXT", en: "Engraving text", ar: "نص الحفر", helpEn: "Printed into the top surface.", helpAr: "ينحفر على الوجه العلوي.", priceDelta: 3_000, max: 20 },
      { type: "CHECKBOX", en: "Add-ons", ar: "إضافات", values: [{ en: "Battery holder", ar: "حامل بطارية", delta: 2_500 }, { en: "Sensor mount", ar: "قاعدة حساس", delta: 2_000 }] },
    ],
  },
  {
    slug: "hex-desk-organizer", type: "CUSTOMIZABLE", category: "accessories", featured: true, preview: true,
    en: "Hex Desk Organizer", ar: "منظّم مكتب سداسي",
    summaryEn: "Modular hexagon organizer for pens, tools and parts.", summaryAr: "منظّم سداسي للأقلام والأدوات والقطع الصغيرة.",
    descEn: "Keep your desk or workbench tidy. Choose size and colour; add a name for a personal touch. Sample listing for development.",
    descAr: "خلي مكتبك أو طاولة شغلك مرتبة. اختار الحجم واللون، وضيف اسم حتى يصير إلك. منتج تجريبي للتطوير.",
    price: 15_000, cost: 4_000, availability: "MADE_TO_ORDER", days: [2, 3], dims: [160, 150, 94], grams: 210,
    materials: ["PLA"], colors: ["Purple", "Black", "White", "Orange"], tags: ["desk", "organizer", "مكتب"], shape: "organizer", color: ORANGE,
    options: [
      { type: "RADIO", en: "Size", ar: "الحجم", required: true, values: [{ en: "Small (3 cells)", ar: "صغير (٣ خانات)" }, { en: "Medium (5 cells)", ar: "وسط (٥ خانات)", delta: 5_000 }, { en: "Large (7 cells)", ar: "كبير (٧ خانات)", delta: 9_000 }] },
      { type: "SELECT", en: "Colour", ar: "اللون", required: true, values: COLOR_VALUES },
      { type: "TEXT", en: "Name on front", ar: "الاسم على الوجه", priceDelta: 2_000, max: 16 },
    ],
  },
  {
    slug: "low-poly-spiral-vase", type: "PHYSICAL", category: "decoration-prints", preview: true,
    en: "Low-Poly Vase", ar: "مزهرية Low-Poly",
    summaryEn: "Faceted decorative vase, printed in vase mode.", summaryAr: "مزهرية ديكور بأوجه هندسية.",
    descEn: "A faceted vase for dried flowers or as a shelf piece. Not watertight. Sample listing for development.",
    descAr: "مزهرية بأوجه هندسية للورد المجفف أو كقطعة ديكور. ما تتحمل مي. منتج تجريبي للتطوير.",
    price: 18_000, cost: 5_000, availability: "MADE_TO_ORDER", days: [2, 4], dims: [96, 96, 160], grams: 120,
    materials: ["Silk PLA"], colors: ["Silk gold", "Silk purple"], tags: ["vase", "decor", "ديكور"], shape: "vase", color: TEAL,
  },
  {
    slug: "headphone-stand", type: "PHYSICAL", category: "accessories",
    en: "Minimal Headphone Stand", ar: "ستاند سماعات بسيط",
    summaryEn: "Weighted-base stand for over-ear headphones.", summaryAr: "ستاند بقاعدة ثقيلة للسماعات الكبيرة.",
    descEn: "Clean, stable and printed in one piece. Sample listing for development.",
    descAr: "بسيط وثابت وينطبع قطعة وحدة. منتج تجريبي للتطوير.",
    price: 22_000, sale: 19_000, cost: 6_500, availability: "MADE_TO_ORDER", days: [2, 4], dims: [110, 110, 220], grams: 260,
    materials: ["PLA+"], colors: ["Black", "White"], tags: ["headphones", "desk", "سماعات"], shape: "headphoneStand", color: WHITE,
  },
  {
    slug: "cable-clips-10-pack", type: "PHYSICAL", category: "home",
    en: "Cable Clips (10 pack)", ar: "مشابك كيبلات (١٠ قطع)",
    summaryEn: "Adhesive-backed clips for tidy cables.", summaryAr: "مشابك تلصق لترتيب الكيبلات.",
    descEn: "Flexible TPU clips hold 3–6 mm cables. In stock. Sample listing for development.",
    descAr: "مشابك TPU مرنة تمسك كيبلات من ٣ إلى ٦ ملم. متوفرة. منتج تجريبي للتطوير.",
    price: 6_000, cost: 1_500, availability: "IN_STOCK", stock: 40, dims: [18, 18, 13], grams: 20,
    materials: ["TPU"], colors: ["Black"], tags: ["cable", "home", "كيبل"], shape: "clips", color: BLACK,
  },
  {
    slug: "robonest-bot-figurine", type: "PHYSICAL_DIGITAL", category: "decoration-prints", featured: true, preview: true, digital: true,
    en: "RoboNest Bot Figurine", ar: "مجسم روبوت RoboNest",
    summaryEn: "Our mascot as a print. Includes the STL to print more.", summaryAr: "شعارنا كمجسم مطبوع، ويجي وياه ملف STL.",
    descEn: "A desk companion inspired by the RoboNest logo. You receive the printed figure plus the STL file in your account after payment. Sample listing for development.",
    descAr: "مجسم للمكتب مستوحى من شعار RoboNest. توصلك القطعة المطبوعة وملف STL بحسابك بعد الدفع. منتج تجريبي للتطوير.",
    price: 25_000, cost: 6_000, availability: "MADE_TO_ORDER", days: [3, 5], dims: [90, 40, 117], grams: 95,
    materials: ["PLA"], colors: ["Purple", "White"], tags: ["figurine", "mascot", "مجسم"], shape: "bot", color: PURPLE,
    options: [
      { type: "NUMBER", en: "Height", ar: "الارتفاع", required: true, min: 80, max: 200, pricePerUnit: 150, unitEn: "mm", unitAr: "ملم", helpEn: "80 mm is the standard size.", helpAr: "٨٠ ملم هو الحجم القياسي." },
      { type: "SELECT", en: "Colour", ar: "اللون", required: true, values: COLOR_VALUES.slice(0, 3) },
    ],
  },
  {
    slug: "parametric-knob-6mm", type: "DIGITAL", category: "functional-parts", digital: true,
    en: "Parametric Knob for 6 mm D-shaft (STL)", ar: "مقبض لعمود D قياس 6 ملم (STL)",
    summaryEn: "Download: knurled knob for potentiometers and encoders.", summaryAr: "ملف للتحميل: مقبض للمقاومات المتغيرة والإنكودرات.",
    descEn: "Print-in-place friendly knob with a press-fit D-shaft socket. Digital file only. Sample listing for development.",
    descAr: "مقبض بفتحة لعمود D يركب بالضغط. ملف رقمي فقط. منتج تجريبي للتطوير.",
    price: 3_000, availability: "DIGITAL", materials: ["PLA", "PETG"], tags: ["knob", "electronics", "مقبض"], shape: "knob", color: GREY,
  },
  {
    slug: "planetary-gearbox-model", type: "DIGITAL", category: "engineering-models", featured: true, preview: true, digital: true,
    en: "Planetary Gearbox (STL set)", ar: "علبة تروس كوكبية (ملفات STL)",
    summaryEn: "Download: 3-planet reduction set for learning and prototyping.", summaryAr: "ملفات للتحميل: مجموعة تروس كوكبية للتعلم والنماذج.",
    descEn: "Sun, three planets and a ring gear with print settings notes. Digital file only. Sample listing for development.",
    descAr: "ترس شمس وثلاث كواكب وترس حلقي مع ملاحظات إعدادات الطباعة. ملف رقمي فقط. منتج تجريبي للتطوير.",
    price: 9_000, availability: "DIGITAL", materials: ["PLA", "PETG"], tags: ["gearbox", "planetary", "تروس"], shape: "gearbox", color: TEAL,
  },
  {
    slug: "low-poly-dragon-egg", type: "DIGITAL", category: "decoration-models", digital: true, preview: true,
    en: "Low-Poly Dragon Egg (STL)", ar: "بيضة تنين Low-Poly (STL)",
    summaryEn: "Download: faceted egg sculpture, supports-free.", summaryAr: "ملف للتحميل: مجسم بيضة بأوجه هندسية بدون دعامات.",
    descEn: "A decorative low-poly egg designed to print without supports. Digital file only. Sample listing for development.",
    descAr: "بيضة ديكور بأوجه هندسية مصممة تنطبع بدون دعامات. ملف رقمي فقط. منتج تجريبي للتطوير.",
    price: 7_500, availability: "DIGITAL", materials: ["PLA", "Silk PLA"], tags: ["dragon", "decor", "تنين"], shape: "egg", color: ORANGE,
  },
  {
    slug: "solar-system-kit", type: "DIGITAL", category: "educational-models", digital: true,
    en: "Solar System Classroom Kit (STL)", ar: "مجموعة المجموعة الشمسية للصف (STL)",
    summaryEn: "Download: scaled planets for school projects.", summaryAr: "ملفات للتحميل: كواكب بمقياس للمشاريع المدرسية.",
    descEn: "Relative-scale planet models for classroom demonstrations. Digital file only. Sample listing for development.",
    descAr: "مجسمات كواكب بمقياس نسبي للشرح بالصف. ملف رقمي فقط. منتج تجريبي للتطوير.",
    price: 12_000, availability: "DIGITAL", materials: ["PLA"], tags: ["education", "space", "تعليم"], shape: "planets", color: [0.35, 0.55, 0.95],
  },
  {
    slug: "filament-spool-holder", type: "PHYSICAL", category: "home",
    en: "Filament Spool Holder", ar: "حامل بكرة فلمنت",
    summaryEn: "Pre-order: bearing-mounted spool holder.", summaryAr: "طلب مسبق: حامل بكرة على بيرنگ.",
    descEn: "Smooth-rolling holder for 1 kg spools. Ships with the next production batch. Sample listing for development.",
    descAr: "حامل ينلف بسلاسة لبكرات ١ كغم. يتشحن ويا الدفعة الجاية من الإنتاج. منتج تجريبي للتطوير.",
    price: 14_000, cost: 4_500, availability: "PREORDER", days: [7, 10], dims: [120, 120, 72], grams: 150,
    materials: ["PETG"], tags: ["3d printing", "workshop", "فلمنت"], shape: "spool", color: GREY,
  },
  {
    slug: "calibration-cube-set", type: "PHYSICAL", category: "engineering-prints",
    en: "Calibration Cube Set", ar: "مجموعة مكعبات معايرة",
    summaryEn: "Three 20 mm reference cubes for checking printer accuracy.", summaryAr: "ثلاث مكعبات مرجعية ٢٠ ملم لفحص دقة الطابعة.",
    descEn: "Printed and measured reference cubes. Sample listing for development.",
    descAr: "مكعبات مرجعية مطبوعة ومقاسة. منتج تجريبي للتطوير.",
    price: 5_000, cost: 1_000, availability: "MADE_TO_ORDER", days: [1, 2], dims: [50, 48, 20], grams: 30,
    materials: ["PLA"], tags: ["calibration", "engineering", "معايرة"], shape: "cubes", color: WHITE,
  },
  {
    slug: "custom-name-keychain", type: "CUSTOM_SERVICE", category: "custom-prints", featured: true,
    en: "Custom Name Keychain", ar: "ميدالية باسمك",
    summaryEn: "Your name or text, printed in two colours.", summaryAr: "اسمك أو أي نص، ينطبع بلونين.",
    descEn: "Type the text you want and choose colours. Great for gifts and events. Sample listing for development.",
    descAr: "اكتب النص اللي تريده واختار الألوان. حلوة للهدايا والمناسبات. منتج تجريبي للتطوير.",
    price: 5_000, cost: 800, availability: "MADE_TO_ORDER", days: [1, 3], dims: [60, 22, 7], grams: 8,
    materials: ["PLA"], tags: ["keychain", "gift", "هدية", "ميدالية"], shape: "keychain", color: PURPLE,
    options: [
      { type: "TEXT", en: "Text", ar: "النص", required: true, min: 1, max: 12, helpEn: "Up to 12 characters, Arabic or English.", helpAr: "لحد ١٢ حرف، عربي أو إنكليزي." },
      { type: "SELECT", en: "Base colour", ar: "لون القاعدة", required: true, values: COLOR_VALUES.slice(0, 4) },
      { type: "RADIO", en: "Font", ar: "الخط", required: true, values: [{ en: "Modern sans", ar: "حديث" }, { en: "Kufi", ar: "كوفي" }] },
    ],
  },
  {
    slug: "logo-plaque-your-file", type: "CUSTOMIZABLE", category: "custom-prints", preview: true,
    en: "Logo Plaque From Your File", ar: "لوحة شعار من ملفك",
    summaryEn: "Upload your logo; we print it as a raised plaque.", summaryAr: "ارفع شعارك ونطبعه لوحة بارزة.",
    descEn: "Send a PNG logo or an STL and we convert it into a wall or desk plaque. We call you to confirm the design before printing. Sample listing for development.",
    descAr: "دزّلنا شعار PNG أو ملف STL ونحوّله للوحة جدار أو مكتب. نتصل بيك نأكد التصميم قبل الطباعة. منتج تجريبي للتطوير.",
    price: 20_000, cost: 5_500, availability: "MADE_TO_ORDER", days: [3, 6], dims: [150, 100, 10], grams: 140,
    materials: ["PLA"], tags: ["logo", "plaque", "شعار"], shape: "plaque", color: BLACK,
    options: [
      { type: "FILE", en: "Your logo file", ar: "ملف الشعار", required: true, helpEn: "PNG, JPG, WEBP or STL, up to 20 MB.", helpAr: "PNG أو JPG أو WEBP أو STL، لحد ٢٠ ميگا." },
      { type: "RADIO", en: "Width", ar: "العرض", required: true, values: [{ en: "10 cm", ar: "١٠ سم" }, { en: "15 cm", ar: "١٥ سم", delta: 8_000 }] },
      { type: "TEXTAREA", en: "Instructions", ar: "تعليمات", max: 500, helpEn: "Colours, mounting holes, text under the logo…", helpAr: "الألوان، فتحات التعليق، نص تحت الشعار…" },
    ],
  },
  {
    slug: "robot-gripper-kit", type: "PHYSICAL", category: "robotics-prints",
    en: "Robot Arm Gripper Kit", ar: "طقم ماسك لذراع روبوت",
    summaryEn: "Servo-driven parallel gripper parts.", summaryAr: "قطع ماسك متوازي يشتغل بسيرفو.",
    descEn: "Printed gripper parts for SG90/MG90S micro servos. Currently out of stock. Sample listing for development.",
    descAr: "قطع ماسك مطبوعة لسيرفو SG90 و MG90S. نافد حالياً. منتج تجريبي للتطوير.",
    price: 35_000, cost: 10_000, availability: "OUT_OF_STOCK", dims: [60, 40, 92], grams: 70,
    materials: ["PETG"], tags: ["robot arm", "gripper", "ذراع"], shape: "gripper", color: PURPLE,
  },
];

// Every supported location uses the flat 5,000 IQD fee (lib/payment-rules.ts).
const ZONES: [string, string, string, number, number, number][] = [
  ["BGD", "Baghdad", "بغداد", 5_000, 1, 2],
  ["BSR", "Basra", "البصرة", 5_000, 2, 3],
  ["NIN", "Nineveh", "نينوى", 5_000, 2, 4],
  ["ERB", "Erbil", "أربيل", 5_000, 2, 3],
  ["SUL", "Sulaymaniyah", "السليمانية", 5_000, 2, 4],
  ["DHK", "Duhok", "دهوك", 5_000, 2, 4],
  ["KRK", "Kirkuk", "كركوك", 5_000, 2, 3],
  ["DIY", "Diyala", "ديالى", 5_000, 2, 3],
  ["ANB", "Anbar", "الأنبار", 5_000, 2, 4],
  ["BAB", "Babil", "بابل", 5_000, 2, 3],
  ["KAR", "Karbala", "كربلاء", 5_000, 2, 3],
  ["NAJ", "Najaf", "النجف", 5_000, 2, 3],
  ["WAS", "Wasit", "واسط", 5_000, 2, 3],
  ["SAL", "Saladin", "صلاح الدين", 5_000, 2, 4],
  ["DQA", "Dhi Qar", "ذي قار", 5_000, 2, 4],
  ["MAY", "Maysan", "ميسان", 5_000, 2, 4],
  ["MUT", "Muthanna", "المثنى", 5_000, 3, 5],
  ["QAD", "Al-Qadisiyyah", "الديوانية", 5_000, 2, 4],
  ["HAL", "Halabja", "حلبجة", 5_000, 3, 5],
];

// ---------------------------------------------------------------------------

async function main() {
  const reset = process.argv.includes("--reset");
  const proxy = await getPlatformProxy<CloudflareEnv>({ configPath: "wrangler.jsonc" });
  const env = proxy.env;
  const db = createDb(env.DB);

  try {
    const existing = await db.$count(products);
    if (existing > 0 && !reset) {
      console.error(`Local database already has ${existing} products. Re-run with --reset to wipe local data.`);
      process.exitCode = 1;
      return;
    }
    if (reset) await wipe(db, env);

    // Admins -----------------------------------------------------------------
    const superPassword = process.env.SEED_SUPER_ADMIN_PASSWORD || randomToken(15);
    const opsPassword = process.env.SEED_OPS_ADMIN_PASSWORD || randomToken(15);
    await db.insert(adminUsers).values([
      { username: "owner", displayName: "Store Owner", role: "SUPER_ADMIN", passwordHash: await hashPassword(superPassword), passwordChangedAt: new Date() },
      { username: "operations", displayName: "Operations", role: "OPERATIONS", passwordHash: await hashPassword(opsPassword), passwordChangedAt: new Date() },
    ]);

    // Test automation only: pre-enroll the Super Admin's TOTP with a known secret.
    if (process.env.SEED_SUPER_ADMIN_TOTP_SECRET) {
      const appSecret = env.APP_SECRET;
      if (!appSecret || appSecret.length < 32) throw new Error("APP_SECRET is required to seed a TOTP secret");
      await db
        .update(adminUsers)
        .set({ totpEnabled: true, totpSecretEnc: await encryptString(appSecret, "admin-totp", process.env.SEED_SUPER_ADMIN_TOTP_SECRET) })
        .where(sql`${adminUsers.username} = 'owner'`);
    }

    // Test automation only: a customer whose phone is already verified, because
    // automated tests cannot receive SMS. Never set these variables elsewhere.
    if (process.env.SEED_CUSTOMER_PHONE && process.env.SEED_CUSTOMER_PASSWORD) {
      const phone = normalizeIraqiPhone(process.env.SEED_CUSTOMER_PHONE);
      if (!phone) throw new Error("SEED_CUSTOMER_PHONE is not a valid Iraqi mobile number");
      await db.insert(users).values({ phone, name: process.env.SEED_CUSTOMER_NAME || "Test Customer", passwordHash: await hashPassword(process.env.SEED_CUSTOMER_PASSWORD), phoneVerifiedAt: new Date(), locale: "en" });
    }

    // Settings ---------------------------------------------------------------
    for (const key of ["store", "homepage", "customPrint", "payments", "security"] as const) {
      const value =
        key === "store" && process.env.SEED_WHATSAPP
          ? { ...DEFAULT_SETTINGS.store, whatsapp: process.env.SEED_WHATSAPP }
          : // Test automation only: record an approval of the manual deposit fallback
            // (methods stay disabled, so high-value orders are still blocked until
            // an admin enables one). Real approval is an owner action in the admin.
            key === "payments" && process.env.SEED_MANUAL_DEPOSIT_APPROVED_BY
            ? { ...DEFAULT_SETTINGS.payments, manualFallback: { approved: true, approvedBy: process.env.SEED_MANUAL_DEPOSIT_APPROVED_BY, approvedAt: new Date().toISOString() } }
            : DEFAULT_SETTINGS[key];
      await saveSetting(db, key, value, actor);
    }

    // Delivery -----------------------------------------------------------------
    const zoneRows = [];
    for (const [i, [code, en, ar, fee, min, max]] of ZONES.entries()) {
      const [row] = await db.insert(deliveryZones).values({ code, nameEn: en, nameAr: ar, fee, etaDaysMin: min, etaDaysMax: max, sortOrder: i }).returning();
      zoneRows.push(row);
    }
    const baghdad = zoneRows.find((z) => z.code === "BGD")!;
    await db.insert(deliveryAreas).values([
      { zoneId: baghdad.id, nameEn: "Karkh", nameAr: "الكرخ", fee: 5_000, sortOrder: 1 },
      { zoneId: baghdad.id, nameEn: "Rusafa", nameAr: "الرصافة", fee: 5_000, sortOrder: 2 },
      { zoneId: baghdad.id, nameEn: "Outskirts (Abu Ghraib, Taji…)", nameAr: "الأطراف (أبو غريب، التاجي…)", fee: 5_000, sortOrder: 3 },
    ]);

    // Categories ---------------------------------------------------------------
    const categoryIds = new Map<string, string>();
    let sort = 0;
    for (const parent of CATEGORY_TREE) {
      const [p] = await db.insert(categories).values({ slug: parent.slug, nameEn: parent.en, nameAr: parent.ar, descriptionEn: parent.descEn, descriptionAr: parent.descAr, sortOrder: sort++ }).returning();
      categoryIds.set(parent.slug, p.id);
      for (const [slug, en, ar] of parent.children) {
        const [c] = await db.insert(categories).values({ slug, nameEn: en, nameAr: ar, parentId: p.id, sortOrder: sort++ }).returning();
        categoryIds.set(slug, c.id);
      }
    }

    // Discount (development only) ------------------------------------------------
    await db.insert(discounts).values({ code: "WELCOME10", description: "Development sample: 10% off", type: "PERCENT", value: 10, maxDiscount: 20_000 });

    // Products -------------------------------------------------------------------
    for (const [index, p] of PRODUCTS.entries()) {
      const created = await createProduct(
        db,
        {
          slug: p.slug,
          productType: p.type,
          categoryId: categoryIds.get(p.category),
          nameEn: p.en,
          nameAr: p.ar,
          summaryEn: p.summaryEn,
          summaryAr: p.summaryAr,
          descriptionEn: p.descEn,
          descriptionAr: p.descAr,
          basePrice: p.price,
          salePrice: p.sale ?? "",
          costPrice: p.cost ?? "",
          availability: p.availability,
          stockQuantity: p.stock ?? "",
          productionDaysMin: p.days?.[0] ?? "",
          productionDaysMax: p.days?.[1] ?? "",
          lengthMm: p.dims?.[0] ?? "",
          widthMm: p.dims?.[1] ?? "",
          heightMm: p.dims?.[2] ?? "",
          weightGrams: p.grams ?? "",
          materials: p.materials.join(", "),
          colors: (p.colors ?? []).join(", "),
          tags: p.tags.join(", "),
          features: (p.features ?? []).map(([en, ar]) => `${en} | ${ar}`).join("\n"),
          included: (p.included ?? []).map(([en, ar]) => `${en} | ${ar}`).join("\n"),
          specifications: (p.specs ?? []).map((s) => s.join(" | ")).join("\n"),
          status: "PUBLISHED",
          isFeatured: p.featured ? "on" : "",
          relatedSlugs: "",
        },
        actor,
      );
      if (!created.ok) throw new Error(`${p.slug}: ${JSON.stringify(created.errors)}`);
      const productId = created.id;
      // Spread creation times so "newest" ordering is meaningful.
      await db.update(products).set({ createdAt: new Date(Date.now() - (PRODUCTS.length - index) * 3_600_000) }).where(sql`${products.id} = ${productId}`);

      const mesh = shapes[p.shape]();
      for (const [i, view] of [{ yaw: -0.65, pitch: 0.5 }, { yaw: 0.9, pitch: 0.35 }].entries()) {
        const image = await renderMesh(mesh, { color: p.color, size: 1000, ...view });
        const key = storageKey("products", "webp");
        await env.MEDIA.put(key, image, { httpMetadata: { contentType: "image/webp" } });
        const imageId = await addProductImage(db, productId, { key, width: 1000, height: 1000, filename: `${p.slug}-${i + 1}.webp` }, actor);
        await updateImageAlt(db, productId, imageId, {
          altEn: `${p.en}, sample render ${i + 1}`,
          altAr: `${p.ar}، صورة تجريبية ${i + 1}`,
        });
      }
      if (p.preview) {
        const key = storageKey("previews", "glb");
        await env.MEDIA.put(key, toGlb(mesh, p.color, p.slug), { httpMetadata: { contentType: "model/gltf-binary" } });
        await setPreviewModel(db, productId, key, actor);
      }
      if (p.digital) {
        const key = storageKey("digital", "stl");
        const stl = toStl(mesh, `RoboNest.3D sample: ${p.slug}`);
        await env.PRIVATE_FILES.put(key, stl, { httpMetadata: { contentType: "model/stl" } });
        await addDigitalFile(db, productId, { key, filename: `${p.slug}.stl`, extension: "stl", sizeBytes: stl.byteLength }, { adminId: null as unknown as string, label: "seed" });
      }

      for (const [oi, o] of (p.options ?? []).entries()) {
        const opt = await saveOption(
          db,
          productId,
          null,
          {
            type: o.type,
            labelEn: o.en,
            labelAr: o.ar,
            helpEn: o.helpEn ?? "",
            helpAr: o.helpAr ?? "",
            isRequired: o.required ? "on" : "",
            priceDelta: o.priceDelta ?? 0,
            pricePerUnit: o.pricePerUnit ?? 0,
            minValue: o.min ?? "",
            maxValue: o.max ?? "",
            unitEn: o.unitEn ?? "",
            unitAr: o.unitAr ?? "",
            sortOrder: oi + 1,
          },
          actor,
        );
        if (!opt.ok) throw new Error(`${p.slug} option ${o.en}: ${JSON.stringify(opt.errors)}`);
        for (const [vi, v] of (o.values ?? []).entries()) {
          const res = await saveOptionValue(db, productId, opt.id, null, { labelEn: v.en, labelAr: v.ar, priceDelta: v.delta ?? 0, swatch: v.swatch ?? "", isActive: "on", sortOrder: vi + 1 }, actor);
          if (!res.ok) throw new Error(`${p.slug} value ${v.en}: ${JSON.stringify(res.errors)}`);
        }
      }
      console.log(`  ✓ ${p.slug}`);
    }

    console.log("\nSeed complete. Admin accounts (store these now; they are not shown again):");
    console.log(`  Super Admin  → username: owner       password: ${superPassword}`);
    console.log(`  Operations   → username: operations  password: ${opsPassword}`);
    console.log("  The Super Admin must enroll TOTP on first sign-in. Discount code for testing: WELCOME10");
  } finally {
    await proxy.dispose();
  }
}

async function wipe(db: Database, env: CloudflareEnv) {
  const tables = [
    "notification_events", "phone_verifications", "audit_logs", "rate_limits", "site_settings", "contact_messages", "wishlist_items", "custom_print_requests",
    "order_status_history", "order_items", "orders", "cart_items", "carts", "uploads", "discounts",
    "addresses", "delivery_areas", "delivery_zones", "digital_files", "product_relations", "product_option_values",
    "product_options", "product_images", "products", "categories", "password_reset_tokens", "sessions", "users",
    "admin_sessions", "admin_users",
  ];
  for (const t of tables) {
    // Sub-categories first: the parent FK is ON DELETE RESTRICT (checked per row).
    if (t === "categories") await db.run(sql.raw("DELETE FROM categories WHERE parent_id IS NOT NULL"));
    // Owner accounts are protected by triggers (migration 0001) and survive a local reset.
    if (t === "admin_users") await db.run(sql.raw("DELETE FROM admin_users WHERE role <> 'OWNER'"));
    else await db.run(sql.raw(`DELETE FROM ${t}`));
  }
  for (const bucket of [env.MEDIA, env.PRIVATE_FILES]) {
    let cursor: string | undefined;
    do {
      const list = await bucket.list({ cursor });
      if (list.objects.length) await bucket.delete(list.objects.map((o) => o.key));
      cursor = list.truncated ? list.cursor : undefined;
    } while (cursor);
  }
  console.log("Local data wiped.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
