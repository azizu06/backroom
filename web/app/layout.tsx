import type { ReactNode } from "react";
import { DemoPill } from "../components/DemoPill";
import { SiteNav } from "../components/SiteNav";

export const metadata = { title: "Backroom" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}><SiteNav />{children}<DemoPill /></body>
    </html>
  );
}
