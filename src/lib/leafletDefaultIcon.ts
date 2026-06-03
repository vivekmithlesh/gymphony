// =============================================================================
// Leaflet default-marker icon fix.
// -----------------------------------------------------------------------------
// Leaflet's default `L.Icon.Default` loads its marker images by relative URL,
// which the bundler can't resolve — so default <Marker> pins render as a broken
// image. Bundling the images via `import ... .png?url` ALSO fails in this
// TanStack Start / Vite setup (deep node_modules asset URLs 404 in dev/SSR).
//
// So we point the default icon at the CDN-hosted Leaflet images (same version as
// package.json, 1.9.4). The map tiles already load from a CDN, so this needs no
// extra network permissions, and it's bundler- and SSR-independent.
//
// IMPORTANT: this module must NOT `import "leaflet"` at the top level — a
// top-level leaflet import crashes SSR ("window is not defined") on every route
// (see the leaflet-ssr-safety note). Each map instead calls
// applyDefaultMarkerIcons(L) on the SAME Leaflet instance it draws with, which
// also avoids the static-vs-dynamic double-instance trap.
// =============================================================================
const LEAFLET_CDN = "https://unpkg.com/leaflet@1.9.4/dist/images";

type LeafletLike = {
  Icon: { Default: { mergeOptions: (options: Record<string, unknown>) => void } };
};

/** Point a Leaflet instance's default marker icon at the CDN-hosted images. */
export function applyDefaultMarkerIcons(L: LeafletLike): void {
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: `${LEAFLET_CDN}/marker-icon-2x.png`,
    iconUrl: `${LEAFLET_CDN}/marker-icon.png`,
    shadowUrl: `${LEAFLET_CDN}/marker-shadow.png`,
  });
}
