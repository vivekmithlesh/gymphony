// Shared ambient background for the dashboard app shells. Two soft pastel corner
// glows sitting strictly behind content (-z-10), over the shell's solid light
// base. Render this as the FIRST child of a `relative overflow-hidden` shell so
// the orbs anchor to the viewport (the overflow clip keeps the off-screen -10%
// offsets from creating scrollbars). Used identically by the Owner and Member
// dashboards so their backgrounds match exactly.
export function AmbientBackground() {
  return (
    <>
      {/* Orb 1 — top-left */}
      <div className="pointer-events-none absolute left-[-10%] top-[-10%] -z-10 h-[500px] w-[500px] rounded-full bg-purple-300/40 blur-[120px]" />
      {/* Orb 2 — bottom-right */}
      <div className="pointer-events-none absolute bottom-[-10%] right-[-10%] -z-10 h-[600px] w-[600px] rounded-full bg-fuchsia-300/30 blur-[120px]" />
    </>
  );
}

export default AmbientBackground;
