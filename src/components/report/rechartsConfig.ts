// Recharts defaults `initialDimension` to `-1`, which triggers a warning before ResizeObserver runs.
// Use a minimal non-zero initial size (0 still warns) and let ResizeObserver update the real dimensions.
export const RECHARTS_INITIAL_DIMENSION = { width: 1, height: 1 };
