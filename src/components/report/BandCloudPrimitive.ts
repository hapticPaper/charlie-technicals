import type {
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  IPriceScaleApi,
  ISeriesPrimitive,
  ITimeScaleApi,
  LogicalRange,
  PrimitivePaneViewZOrder,
  IRange,
  SeriesAttachedParameter,
  Time
} from "lightweight-charts";

import type { CanvasRenderingTarget2D } from "fancy-canvas";

export type BandCloudPoint = {
  time: Time;
  upper: number | null;
  lower: number | null;
};

export type BandCloudPrimitiveOptions = {
  fillColor: string;
  zOrder?: PrimitivePaneViewZOrder;
};

// `fillColor` may change at runtime (e.g. theme changes). z-order is fixed by chart layering.
export interface BandCloudPrimitiveMutableOptions {
  fillColor?: BandCloudPrimitiveOptions["fillColor"];
}

type BandCloudCoord = {
  x: number;
  yUpper: number;
  yLower: number;
};

class BandCloudRenderer implements IPrimitivePaneRenderer {
  readonly #segments: readonly (readonly BandCloudCoord[])[];
  readonly #fillColor: string;

  constructor(segments: readonly (readonly BandCloudCoord[])[], fillColor: string) {
    this.#segments = segments;
    this.#fillColor = fillColor;
  }

  draw(target: CanvasRenderingTarget2D): void {
    if (this.#segments.length === 0) {
      return;
    }

    target.useMediaCoordinateSpace(({ context }) => {
      context.save();
      context.fillStyle = this.#fillColor;

      for (const segment of this.#segments) {
        if (segment.length < 2) {
          continue;
        }

        context.beginPath();
        context.moveTo(segment[0].x, segment[0].yUpper);

        for (let idx = 1; idx < segment.length; idx += 1) {
          const point = segment[idx];
          context.lineTo(point.x, point.yUpper);
        }

        for (let idx = segment.length - 1; idx >= 0; idx -= 1) {
          const point = segment[idx];
          context.lineTo(point.x, point.yLower);
        }

        context.closePath();
        context.fill();
      }

      context.restore();
    });
  }
}

class BandCloudView implements IPrimitivePaneView {
  readonly #primitive: BandCloudPrimitive;
  #renderer: BandCloudRenderer | null = null;

  constructor(primitive: BandCloudPrimitive) {
    this.#primitive = primitive;
  }

  update(): void {
    this.#renderer = this.#primitive.buildRenderer();
  }

  zOrder(): PrimitivePaneViewZOrder {
    return this.#primitive.zOrder;
  }

  renderer(): IPrimitivePaneRenderer | null {
    return this.#renderer;
  }
}

export class BandCloudPrimitive implements ISeriesPrimitive<Time> {
  readonly #view: BandCloudView;
  #attached: SeriesAttachedParameter<Time> | null = null;
  #data: readonly BandCloudPoint[] = [];
  #fillColor: string;
  #renderer: BandCloudRenderer | null = null;
  #lastViewport: {
    timeScaleWidth: number;
    scrollPosition: number;
    visibleLogicalRange: LogicalRange | null;
    priceVisibleRange: IRange<number> | null;
    fillColor: string;
    dataRef: readonly BandCloudPoint[];
  } | null = null;
  readonly zOrder: PrimitivePaneViewZOrder;

  constructor(options: BandCloudPrimitiveOptions) {
    this.#view = new BandCloudView(this);
    this.#fillColor = options.fillColor;
    this.zOrder = options.zOrder ?? "bottom";
  }

  // Points must be provided in ascending time order, consistent with Lightweight Charts series data.
  setData(points: readonly BandCloudPoint[]): void {
    this.#data = points;
    this.updateAllViews();
    this.#attached?.requestUpdate();
  }

  // Currently only `fillColor` is supported. Extend this when new mutable options are added.
  setOptions(next: BandCloudPrimitiveMutableOptions): void {
    const nextFill = next.fillColor;
    if (nextFill === undefined || nextFill === this.#fillColor) {
      return;
    }

    this.#fillColor = nextFill;
    this.updateAllViews();
    this.#attached?.requestUpdate();
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [this.#view];
  }

  updateAllViews(): void {
    this.#view.update();
  }

  attached(param: SeriesAttachedParameter<Time>): void {
    this.#attached = param;
    this.updateAllViews();
  }

  detached(): void {
    this.#attached = null;
    this.#renderer = null;
    this.#lastViewport = null;
  }

  buildRenderer(): BandCloudRenderer | null {
    if (!this.#attached) {
      return null;
    }

    const { chart, series } = this.#attached;
    const timeScale: ITimeScaleApi<Time> = chart.timeScale();
    const priceScale: IPriceScaleApi = series.priceScale();

    const timeScaleWidth = timeScale.width();
    const scrollPosition = timeScale.scrollPosition();
    const visibleLogicalRange = timeScale.getVisibleLogicalRange();
    const priceVisibleRange = priceScale.getVisibleRange();

    const cacheKeyUnchanged =
      this.#lastViewport !== null &&
      this.#lastViewport.timeScaleWidth === timeScaleWidth &&
      this.#lastViewport.scrollPosition === scrollPosition &&
      logicalRangesEqual(this.#lastViewport.visibleLogicalRange, visibleLogicalRange) &&
      numericRangesEqual(this.#lastViewport.priceVisibleRange, priceVisibleRange) &&
      this.#lastViewport.fillColor === this.#fillColor &&
      this.#lastViewport.dataRef === this.#data;

    if (cacheKeyUnchanged) {
      return this.#renderer;
    }

    const segments: BandCloudCoord[][] = [];
    let current: BandCloudCoord[] = [];

    const flush = () => {
      if (current.length >= 2) {
        segments.push(current);
      }
      current = [];
    };

    for (const point of this.#data) {
      if (
        typeof point.upper !== "number" ||
        !Number.isFinite(point.upper) ||
        typeof point.lower !== "number" ||
        !Number.isFinite(point.lower)
      ) {
        flush();
        continue;
      }

      const x = timeScale.timeToCoordinate(point.time);
      const yUpper = series.priceToCoordinate(point.upper);
      const yLower = series.priceToCoordinate(point.lower);

      if (x === null || yUpper === null || yLower === null) {
        flush();
        continue;
      }

      const yTop = Math.min(yUpper, yLower);
      const yBottom = Math.max(yUpper, yLower);
      current.push({ x, yUpper: yTop, yLower: yBottom });
    }

    flush();

    this.#lastViewport = {
      timeScaleWidth,
      scrollPosition,
      visibleLogicalRange,
      priceVisibleRange,
      fillColor: this.#fillColor,
      dataRef: this.#data
    };

    this.#renderer = segments.length > 0 ? new BandCloudRenderer(segments, this.#fillColor) : null;
    return this.#renderer;
  }
}

function logicalRangesEqual(left: LogicalRange | null, right: LogicalRange | null): boolean {
  if (left === null || right === null) {
    return left === right;
  }

  return left.from === right.from && left.to === right.to;
}

function numericRangesEqual(left: IRange<number> | null, right: IRange<number> | null): boolean {
  if (left === null || right === null) {
    return left === right;
  }

  return left.from === right.from && left.to === right.to;
}
