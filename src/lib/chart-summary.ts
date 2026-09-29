type T = (key: string, values?: Record<string, string | number>) => string;

/** Text alternative for a column chart (screen readers get the gist without the table). */
export function chartSummary(t: T, label: string, series: { day: string; value: number }[], fmt: (n: number) => string) {
  const total = series.reduce((s, p) => s + p.value, 0);
  const top = series.reduce((a, b) => (b.value > a.value ? b : a), series[0] ?? { day: "", value: 0 });
  return t("chartSummary", { label, total: fmt(total), days: series.length, max: fmt(top.value), day: top.day });
}
