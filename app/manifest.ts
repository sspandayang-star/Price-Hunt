import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Price Hunt",
    short_name: "Price Hunt",
    description: "The cheapest price you can trust, across Singapore stores and marketplaces.",
    start_url: "/",
    display: "standalone",
    background_color: "#f1f4f1",
    theme_color: "#13201a",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
