export type Tone = "neutral" | "primary" | "success" | "warning" | "danger" | "info";

/** Badge tone per order status; the badge always carries the status text too. */
export function orderStatusTone(status: string): Tone {
  if (status === "DELIVERED") return "success";
  if (status === "PENDING") return "warning";
  if (["CANCELLED", "FAILED_DELIVERY", "RETURNED", "RETURN_REQUESTED"].includes(status)) return "danger";
  return "primary";
}
