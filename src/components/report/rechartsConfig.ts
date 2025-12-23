// Recharts defaults `initialDimension` to `-1`, which triggers a warning before ResizeObserver runs.
// Use a minimal non-zero initial size (0 still warns). This can render at 1×1 briefly until
// ResizeObserver updates the real dimensions; reuse this for consistent behavior across charts.
export const RECHARTS_INITIAL_DIMENSION = { width: 1, height: 1 };
