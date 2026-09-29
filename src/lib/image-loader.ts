// next/image loader. In production (NEXT_PUBLIC_IMAGE_TRANSFORMS=cloudflare)
// images are resized and converted to AVIF/WebP at the edge by Cloudflare
// Image Transformations; the original stays in R2. Locally, originals are
// served as-is (the width parameter is ignored by the /media route).
type LoaderArgs = { src: string; width: number; quality?: number };

export default function imageLoader({ src, width, quality }: LoaderArgs): string {
  if (process.env.NEXT_PUBLIC_IMAGE_TRANSFORMS === "cloudflare" && src.startsWith("/")) {
    return `/cdn-cgi/image/width=${width},quality=${quality ?? 80},format=auto,fit=scale-down${src}`;
  }
  return `${src}${src.includes("?") ? "&" : "?"}w=${width}`;
}
