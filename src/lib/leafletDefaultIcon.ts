// =============================================================================
// Leaflet default-marker icon fix for Vite.
// -----------------------------------------------------------------------------
// Leaflet's default `L.Icon.Default` loads its marker images by relative URL,
// which Vite's bundler can't resolve — so default <Marker> pins render as a
// broken image. Importing the images through the bundler and pointing the
// default icon at the resolved URLs restores the stock blue pin everywhere.
//
// `leaflet` is a singleton module, so this side-effect import applies to every
// map in the app (including components that lazy-load leaflet). Import this
// module once, for its side effect, in any file that renders a default Marker:
//   import "@/lib/leafletDefaultIcon";
// =============================================================================
import L from "leaflet";
import iconRetinaUrl from "leaflet/dist/images/marker-icon-2x.png";
import iconUrl from "leaflet/dist/images/marker-icon.png";
import shadowUrl from "leaflet/dist/images/marker-shadow.png";

L.Icon.Default.mergeOptions({ iconRetinaUrl, iconUrl, shadowUrl });

export {};
