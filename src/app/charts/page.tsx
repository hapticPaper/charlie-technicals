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
        <details key={e.url} style={{ marginTop: 12 }}>
          <summary>{e.label}</summary>
          <p className="report-muted" style={{ margin: "6px 0 10px" }}>
            <a href={e.url} target="_blank" rel="noreferrer">
              Open in a new tab
            </a>
          </p>
          <iframe
            title={e.label}
            src={e.url}
            loading="lazy"
            style={{
              width: "100%",
              height: 640,
              border: "1px solid var(--rp-border)",
              borderRadius: 12,
              background: "var(--rp-surface)"
            }}
          />
        </details>
      ))}
    </>
  );
}
