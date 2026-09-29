import { notFound } from "next/navigation";

// Any unmatched localized URL renders the branded 404 (with header/footer).
export default function CatchAll() {
  notFound();
}
