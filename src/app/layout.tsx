import type { ReactNode } from "react";

import Script from "next/script";

import "./globals.css";

const GTM_ID = "GTM-NG943PNQ";

const GOOGLE_TAG_ID = "G-MTVFMHE6C8";

const GTM_BOOTSTRAP_SCRIPT = `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${GTM_ID}');`;

const GOOGLE_TAG_SCRIPT_SRC = `https://www.googletagmanager.com/gtag/js?id=${GOOGLE_TAG_ID}`;

const GOOGLE_TAG_BOOTSTRAP_SCRIPT = `window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());

gtag('config', '${GOOGLE_TAG_ID}');
`;

const GTM_NO_SCRIPT = `<iframe src="https://www.googletagmanager.com/ns.html?id=${GTM_ID}" height="0" width="0" style="display:none;visibility:hidden"></iframe>`;

export const metadata = {
  title: "Charlie technicals",
  description: "Market technicals pipeline driven by Charlie playbooks"
};

export default function RootLayout(props: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <Script
          id="google-tag-manager"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: GTM_BOOTSTRAP_SCRIPT
          }}
        />
        <Script id="google-tag" src={GOOGLE_TAG_SCRIPT_SRC} strategy="beforeInteractive" />
        <Script
          id="google-tag-bootstrap"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: GOOGLE_TAG_BOOTSTRAP_SCRIPT
          }}
        />
      </head>
      <body className="rpAppShell">
        <noscript dangerouslySetInnerHTML={{ __html: GTM_NO_SCRIPT }} />
        <main className="rpAppMain">
          <div className="rpAppContent">{props.children}</div>
        </main>
      </body>
    </html>
  );
}
