import type { ReactNode } from "react";

import "./globals.css";

export const metadata = {
  title: "Charlie technicals",
  description: "Market technicals pipeline driven by Charlie playbooks"
};

export default function RootLayout(props: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="rpAppShell">
        <main className="rpAppMain">
          <div className="rpAppGrid">
            <div className="rpAppContent">{props.children}</div>
            <aside className="rpAppSidebar" />
          </div>
        </main>
      </body>
    </html>
  );
}
