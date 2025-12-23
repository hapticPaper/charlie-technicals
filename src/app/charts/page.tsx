"use client";

import { useEffect, useId, useRef, useState } from "react";

type PluginExample = {
  label: string;
  url: string;
  sandbox?: string;
};

// Intentionally omit allow-same-origin to reduce third-party iframe privileges.
const DEFAULT_IFRAME_SANDBOX = "allow-scripts";
const IFRAME_LOAD_TIMEOUT_MS = 5000;

const PLUGIN_EXAMPLES: ReadonlyArray<PluginExample> = [
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
];

function ChartsExampleEmbed(props: { label: string; url: string; sandbox?: string }) {
  const { label, url, sandbox } = props;
  const statusId = useId();
  const [timedOut, setTimedOut] = useState(false);
  const [failed, setFailed] = useState(false);
  const loadedRef = useRef(false);
  const timeoutIdRef = useRef<number | null>(null);

  const clearLoadTimeout = () => {
    if (timeoutIdRef.current !== null) {
      window.clearTimeout(timeoutIdRef.current);
      timeoutIdRef.current = null;
    }
  };

  useEffect(() => {
    loadedRef.current = false;
    setFailed(false);
    setTimedOut(false);

    clearLoadTimeout();

    timeoutIdRef.current = window.setTimeout(() => {
      if (!loadedRef.current) {
        setTimedOut(true);
        setFailed(true);
      }

      timeoutIdRef.current = null;
    }, IFRAME_LOAD_TIMEOUT_MS);

    return () => {
      clearLoadTimeout();
    };
  }, [url]);

  return (
    <details style={{ marginTop: 12 }}>
      <summary>{label}</summary>
      <p id={statusId} role="status" className="report-muted" style={{ margin: "6px 0 10px" }}>
        <a href={url} target="_blank" rel="noreferrer">
          Open in a new tab
        </a>
        {failed
          ? timedOut
            ? " · Load timed out (may be blocked)"
            : " · Embedding failed"
          : ""}
      </p>

      <iframe
        title={label}
        aria-describedby={statusId}
        src={url}
        loading="lazy"
        sandbox={sandbox ?? DEFAULT_IFRAME_SANDBOX}
        referrerPolicy="no-referrer"
        onLoad={() => {
          loadedRef.current = true;
          setFailed(false);
          setTimedOut(false);
          clearLoadTimeout();
        }}
        onError={() => {
          setFailed(true);
          setTimedOut(false);
          clearLoadTimeout();
        }}
        style={{
          width: "100%",
          height: 640,
          border: "1px solid var(--rp-border)",
          borderRadius: 12,
          background: "var(--rp-surface)"
        }}
      />

      <p className="report-muted" style={{ margin: "10px 0 0" }}>
        Some upstream examples may block embedding or load slowly. If the chart doesn’t load, use the “Open in a new tab”
        link above.
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
        <ChartsExampleEmbed key={e.url} label={e.label} url={e.url} sandbox={e.sandbox} />
      ))}
    </>
  );
}
