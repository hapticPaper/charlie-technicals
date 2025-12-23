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

      <ul>
        {PLUGIN_EXAMPLES.map((e) => (
          <li key={e.url}>
            <a href={e.url} target="_blank" rel="noreferrer">
              {e.label}
            </a>
          </li>
        ))}
      </ul>
    </>
  );
}
