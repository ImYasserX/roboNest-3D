"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { usePathname } from "@/i18n/navigation";
import { Link } from "@/i18n/navigation";
import { toggleWishlistAction } from "@/server/actions/wishlist";
import { HeartIcon } from "@/components/ui/icons";
import { buttonClass } from "@/components/ui/button";

export function WishlistButton({ productId, initialSaved, signedIn }: { productId: string; initialSaved: boolean; signedIn: boolean }) {
  const t = useTranslations("product");
  const pathname = usePathname();
  const [saved, setSaved] = useState(initialSaved);
  const [pending, startTransition] = useTransition();

  if (!signedIn) {
    return (
      <Link href={`/login?next=${encodeURIComponent(pathname)}`} className={buttonClass("outline", "md")}>
        <HeartIcon size={18} />
        {t("saveSignIn")}
      </Link>
    );
  }
  return (
    <button
      type="button"
      className={buttonClass("outline", "md")}
      aria-pressed={saved}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await toggleWishlistAction(productId);
          if (res.ok) setSaved(res.saved);
        })
      }
    >
      <HeartIcon size={18} filled={saved} className={saved ? "text-danger" : undefined} />
      {saved ? t("saved") : t("save")}
    </button>
  );
}
