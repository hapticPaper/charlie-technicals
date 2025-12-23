"use client";

import { useState } from "react";

const PLUGIN_EXAMPLES = [
  {
    label: "All plugin examples",
    url: "https://tradingview.github.io/lightweight-charts/plugin-examples/"
  },
  {
    label: "Delta brushable (combined)",
    url: "https://tradingview.github.io/lightweight-charts/plugin-examples/combined-examples/delta-brushable/"
  },
  {
    label: "Dual range histogram series",
    url: "https://tradingview.github.io/lightweight-charts/plugin-examples/plugins/dual-range-histogram-series/example/"
  },
  {
    label: "Background shade series",
    url: "https://tradingview.github.io/lightweight-charts/plugin-examples/plugins/background-shade-series/example/"
  },
  {
    label: "HLC area series",
    url: "https://tradingview.github.io/lightweight-charts/plugin-examples/plugins/hlc-area-series/example/"
  },
  {
    label: "Expiring price alerts",
    url: "https://tradingview.github.io/lightweight-charts/plugin-examples/plugins/expiring-price-alerts/example/"
  },
  {
    label: "Trend line",
    url: "https://tradingview.github.io/lightweight-charts/plugin-examples/plugins/trend-line/example/"
  },
  {
    label: "Volume profile",
    url: "https://tradingview.github.io/lightweight-charts/plugin-examples/plugins/volume-profile/example/"
  },
  {
    label: "Bands indicator",
    url: "https://tradingview.github.io/lightweight-charts/plugin-examples/plugins/bands-indicator/example/"
  },
  {
    label: "Image watermark",
    url: "https://tradingview.github.io/lightweight-charts/plugin-examples/plugins/image-watermark/example/"
  },
  {
    label: "Stacked area series",
    url: "https://tradingview.github.io/lightweight-charts/plugin-examples/plugins/stacked-area-series/example/"
  },
  {
    label: "Heatmap series (example2)",
    url: "https://tradingview.github.io/lightweight-charts/plugin-examples/plugins/heatmap-series/example/example2.html"
  }
] as const;

function ChartsExampleEmbed(props: { label: string; url: string }) {
  const { label, url } = props;
  const [failed, setFailed] = useState(false);

  return (
    <details style={{ marginTop: 12 }}>
      <summary>{label}</summary>
      <p className="report-muted" style={{ margin: "6px 0 10px" }}>
        <a href={url} target="_blank" rel="noreferrer">
          Open in a new tab
        </a>
        {failed ? " · Embedding blocked" : ""}
      </p>

      {failed ? null : (
        <iframe
          title={label}
          src={url}
          loading="lazy"
          sandbox="allow-scripts allow-same-origin"
          referrerPolicy="no-referrer"
          onError={() => {
            setFailed(true);
          }}
          style={{
            width: "100%",
            height: 640,
            border: "1px solid var(--rp-border)",
            borderRadius: 12,
            background: "var(--rp-surface)"
          }}
        />
      )}

      <p className="report-muted" style={{ margin: "10px 0 0" }}>
        Some upstream examples may block embedding. If the chart doesn’t load, use the “Open in a new tab” link above.
      </p>
    </details>
  );
}

export default function ChartsPlaygroundPage() {
  return (
    <>
      <h1>Charts playground</h1>
      <p className="report-muted">
        Reference links for lightweight-charts plugin examples. These are the upstream examples we’re using as a
        design/implementation guide.
      </p>

      <p>
        <a href={PLUGIN_EXAMPLES[0].url} target="_blank" rel="noreferrer">
          {PLUGIN_EXAMPLES[0].label}
        </a>
      </p>

      {PLUGIN_EXAMPLES.slice(1).map((e) => (
        <ChartsExampleEmbed key={e.url} label={e.label} url={e.url} />
      ))}
    </>
  );
}
