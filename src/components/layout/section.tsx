import { Link } from "@/i18n/navigation";
import { ChevronIcon } from "@/components/ui/icons";
import { Container } from "@/components/ui/misc";

export function Section({
  id,
  title,
  description,
  href,
  hrefLabel,
  children,
  className,
}: {
  id: string;
  title: string;
  description?: string;
  href?: string;
  hrefLabel?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section aria-labelledby={`${id}-title`} className={className ?? "py-14 sm:py-20"}>
      <Container>
        <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <h2 id={`${id}-title`} className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
              {title}
            </h2>
            {description ? <p className="max-w-2xl text-muted">{description}</p> : null}
          </div>
          {href && hrefLabel ? (
            <Link href={href} className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-primary-text hover:underline">
              {hrefLabel}
              <ChevronIcon size={16} className="rtl:rotate-180" />
            </Link>
          ) : null}
        </div>
        {children}
      </Container>
    </section>
  );
}
