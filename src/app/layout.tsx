import type { Metadata } from "next";
import "./globals.css";
import "./experience.css";
export const metadata: Metadata = {
  title: "Talk To Future — Interview practice",
  description:
    "Three questions. Room to think. Practice interviews without coding.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{document.documentElement.dataset.theme=localStorage.getItem("talk-to-future:theme")==="dark"?"dark":"light"}catch{document.documentElement.dataset.theme="light"}`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
