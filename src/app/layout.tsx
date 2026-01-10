import type { ReactNode } from "react";

import Script from "next/script";

import "./globals.css";

const GTM_ID = "GTM-NG943PNQ";

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
            __html: `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${GTM_ID}');`
          }}
        />
      </head>
      <body className="rpAppShell">
        <noscript>
          <iframe
            src={`https://www.googletagmanager.com/ns.html?id=${GTM_ID}`}
            height="0"
            width="0"
            style={{ display: "none", visibility: "hidden" }}
          />
        </noscript>
        <main className="rpAppMain">
          <div className="rpAppContent">{props.children}</div>
        </main>
      </body>
    </html>
  );
}
