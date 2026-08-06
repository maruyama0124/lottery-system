import type { Metadata } from "next";
import { Noto_Sans_JP } from "next/font/google";
import { AuthProvider } from "@/lib/auth-context";
import "./globals.css";

// デジタル庁デザインシステム（マイナポータル等）が標準とする書体に合わせる。
// next/font はビルド時に取り込んでセルフホストするため、外部への通信は発生しない。
// 可変フォントなので weight の列挙は不要。
const notoSansJP = Noto_Sans_JP({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-noto-sans-jp",
});

export const metadata: Metadata = {
  title: "練習抽選bot クエーさん",
  description: "バレーボールサークルの練習参加抽選システム",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className={notoSansJP.variable}>
      <body className="font-sans antialiased">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
