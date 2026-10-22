import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Local LLM Console",
  description: "Local inference benchmark results",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">Skip to main content</a>
        <div id="main-content">{children}</div>
      </body>
    </html>
  );
}
