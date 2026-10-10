import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "RoboNest.3D",
    short_name: "RoboNest.3D",
    description: "3D printing, custom manufacturing and CAD design by RoboNest.3D.",
    start_url: "/",
    display: "standalone",
    background_color: "#0c0a14",
    theme_color: "#7f56d9",
    icons: [
      { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/brand/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
