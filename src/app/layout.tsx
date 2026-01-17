import type { ReactNode } from "react";

import Link from "next/link";
import Script from "next/script";

import "./globals.css";
import { NavLink } from "../components/nav/NavLink";
import { ThemeToggle } from "../components/theme/ThemeToggle";
import { THEME_STORAGE_KEY } from "../components/theme/themeConstants";

const GTM_ID = "GTM-NG943PNQ";

const GTM_BOOTSTRAP_SCRIPT = `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${GTM_ID}');`;

const GTM_NO_SCRIPT = `<iframe src="https://www.googletagmanager.com/ns.html?id=${GTM_ID}" height="0" width="0" style="display:none;visibility:hidden"></iframe>`;

const THEME_INIT_SCRIPT = `(function(){try{var k='${THEME_STORAGE_KEY}';var t=localStorage.getItem(k);if(t==='light'||t==='dark'){document.documentElement.dataset.theme=t;}else{delete document.documentElement.dataset.theme;if(t&&t!=='system'){localStorage.removeItem(k);}}}catch(e){}})();`;

export const metadata = {
  title: "Charlie technicals",
  description: "Market technicals pipeline driven by Charlie playbooks"
};

export default function RootLayout(props: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <Script id="rp-theme-init" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <Script
          id="google-tag-manager"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: GTM_BOOTSTRAP_SCRIPT
          }}
        />
      </head>
      <body className="rpAppShell">
        <noscript dangerouslySetInnerHTML={{ __html: GTM_NO_SCRIPT }} />
        <header className="rpTopBar">
          <div className="rpAppContent rpTopBarInner">
            <Link className="rpBrand" href="/">
              <span className="rpBrandTitle">Charlie technicals</span>
              <span className="rpBrandTagline">Daily market reports, setups, and portfolio</span>
            </Link>
            <div className="rpNav">
              <NavLink href="/portfolio" exact>
                Portfolio
              </NavLink>
              <ThemeToggle />
            </div>
          </div>
        </header>
        <main className="rpAppMain">
          <div className="rpAppContent">{props.children}</div>
        </main>
      </body>
    </html>
  );
}
