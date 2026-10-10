import { Container } from "@/components/ui/misc";

/** Skeleton while the category showcase loads. */
export default function CategoriesLoading() {
  return (
    <Container className="space-y-12 py-10" aria-busy="true">
      <div className="space-y-3 border-b border-border pb-6">
        <div className="h-9 w-56 animate-pulse rounded-md bg-surface-2" />
        <div className="h-5 w-80 max-w-full animate-pulse rounded-md bg-surface-2" />
      </div>
      {[0, 1].map((i) => (
        <div key={i} className="space-y-5">
          <div className="h-64 animate-pulse rounded-2xl border border-border bg-surface" />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((j) => (
              <div key={j} className="h-16 animate-pulse rounded-xl border border-border bg-surface" />
            ))}
          </div>
        </div>
      ))}
    </Container>
  );
}
