import type { ReactNode } from "react";
import { Bubbles } from "../components/Bubbles";
import { DemoPill } from "../components/DemoPill";
import { SiteNav } from "../components/SiteNav";
import { THEME_INIT_SCRIPT } from "../lib/theme";
// Office overlay tokens (:root --office-*) for the 3D office chrome.
import "./office/lobby.css";
// Shared page palette (AJ's tokens, light/dark) for every page, the nav and the pill.
import "./theme.css";

export const metadata = { title: "Backrooms" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} /></head>
      <body style={{ margin: 0 }}><Bubbles /><SiteNav />{children}<DemoPill /></body>
    </html>
  );
}
