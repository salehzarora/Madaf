import type { MetadataRoute } from "next";
import { defaultLocale, dirFor } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { appIdentity } from "@/lib/app-identity";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: appIdentity.name,
    short_name: appIdentity.name,
    description: getDictionary(defaultLocale).meta.description,
    // The existing locale redirect remains authoritative for app launch.
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: appIdentity.backgroundColor,
    theme_color: appIdentity.themeColor,
    lang: defaultLocale,
    dir: dirFor(defaultLocale),
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/madaf-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/madaf-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/madaf-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
