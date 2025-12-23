// Minimal non-zero size used to bypass Recharts' default `initialDimension = -1` warning.
// This can render at 1×1 briefly until ResizeObserver updates the real dimensions; override per chart
// if that ever causes noticeable layout shift.
// Returns a fresh object to avoid accidental shared mutation across charts.
export function getRechartsInitialDimension() {
  return { width: 1, height: 1 };
}
