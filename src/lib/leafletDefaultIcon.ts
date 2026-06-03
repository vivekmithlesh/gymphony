// =============================================================================
// Leaflet marker icon — explicit, bundler- and SSR-proof.
// -----------------------------------------------------------------------------
// Default <Marker> pins render broken/blank because Leaflet's L.Icon.Default
// resolves its images by relative URL, which the bundler rewrites to a path the
// TanStack Start / Vite dev server doesn't serve (404 → broken-image box). The
// `?url` import trick 404s the same way here.
//
// Rather than patch the implicit default (timing- and HMR-sensitive), we build
// an EXPLICIT L.Icon pointed at the CDN-hosted Leaflet 1.9.4 images and pass it
// straight to every <Marker icon={...}>. An explicit icon with a 200 URL always
// renders. (Tiles already load from a CDN, so no new network permission.)
//
// This module deliberately does NOT `import "leaflet"` — that would crash SSR
// ("window is not defined") on every route (see leaflet-ssr-safety). It only
// receives a Leaflet instance and returns an icon, so it's safe to import
// anywhere; each map passes its own L.
// =============================================================================
const LEAFLET_CDN = "https://unpkg.com/leaflet@1.9.4/dist/images";

// Just the icon-option shape we use — kept compatible with Leaflet's IconOptions
// (which requires iconUrl) so the real `L` is assignable here without `any`.
type IconImageOptions = {
  iconUrl: string;
  iconRetinaUrl?: string;
  shadowUrl?: string;
  iconSize?: [number, number];
  iconAnchor?: [number, number];
  popupAnchor?: [number, number];
  tooltipAnchor?: [number, number];
  shadowSize?: [number, number];
};
type LeafletLike = { icon: (options: IconImageOptions) => unknown };

/** Build the standard blue Leaflet pin (CDN images) for a given Leaflet instance. */
export function createDefaultMarkerIcon(L: LeafletLike): unknown {
  return L.icon({
    iconUrl: `${LEAFLET_CDN}/marker-icon.png`,
    iconRetinaUrl: `${LEAFLET_CDN}/marker-icon-2x.png`,
    shadowUrl: `${LEAFLET_CDN}/marker-shadow.png`,
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    tooltipAnchor: [16, -28],
    shadowSize: [41, 41],
  });
}
