import type { ReactNode } from "react";
import { RealVsSim } from "../components/RealVsSim";
import { DemoBanner } from "../lib/demo/Banner";
import { SiteNav } from "../components/SiteNav";

export const metadata = { title: "Backroom" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}><DemoBanner /><SiteNav />{children}<RealVsSim /></body>
    </html>
  );
}
