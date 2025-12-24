import type {
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesPrimitive,
  PrimitivePaneViewZOrder,
  SeriesAttachedParameter,
  Time
} from "lightweight-charts";

import type { CanvasRenderingTarget2D } from "fancy-canvas";

export type BandCloudPoint = {
  time: Time;
  upper: number;
  lower: number;
};

export type BandCloudPrimitiveOptions = {
  fillColor: string;
  zOrder?: PrimitivePaneViewZOrder;
};

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
  readonly zOrder: PrimitivePaneViewZOrder;

  constructor(options: BandCloudPrimitiveOptions) {
    this.#view = new BandCloudView(this);
    this.#fillColor = options.fillColor;
    this.zOrder = options.zOrder ?? "bottom";
  }

  setData(points: readonly BandCloudPoint[]): void {
    this.#data = points;
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
  }

  buildRenderer(): BandCloudRenderer | null {
    if (!this.#attached) {
      return null;
    }

    const { chart, series } = this.#attached;
    const timeScale = chart.timeScale();

    const segments: BandCloudCoord[][] = [];
    let current: BandCloudCoord[] = [];

    const flush = () => {
      if (current.length >= 2) {
        segments.push(current);
      }
      current = [];
    };

    for (const point of this.#data) {
      if (!Number.isFinite(point.upper) || !Number.isFinite(point.lower)) {
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

      current.push({ x, yUpper, yLower });
    }

    flush();

    if (segments.length === 0) {
      return null;
    }

    return new BandCloudRenderer(segments, this.#fillColor);
  }
}
