import type { Metadata } from "next";
import { Anek_Malayalam, Manrope, Noto_Sans_Malayalam } from "next/font/google";
import "./globals.css";

const manrope = Manrope({ variable: "--font-manrope", subsets: ["latin"] });
const anek = Anek_Malayalam({ variable: "--font-anek-malayalam", subsets: ["latin", "malayalam"] });
const notoMalayalam = Noto_Sans_Malayalam({ variable: "--font-noto-malayalam", subsets: ["malayalam"] });

export const metadata: Metadata = {
  title: "AroNexa",
  description: "AroNexa for doctors and patients",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${manrope.variable} ${anek.variable} ${notoMalayalam.variable}`}>
      <body>{children}</body>
    </html>
  );
}
