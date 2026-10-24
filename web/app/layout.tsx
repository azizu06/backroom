import type { ReactNode } from "react";
import { RealVsSim } from "../components/RealVsSim";

export const metadata = { title: "Backroom" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>{children}<RealVsSim /></body>
    </html>
  );
}
