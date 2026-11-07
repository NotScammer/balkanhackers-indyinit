import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Rehearsal — Interview practice",
  description:
    "Three questions. Room to think. Practice interviews without coding.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{document.documentElement.dataset.theme=localStorage.getItem("rehearsal:theme")==="light"?"light":"dark"}catch{}`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
