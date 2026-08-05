import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 開発サーバーは既定で localhost 以外からのリクエストを拒否する。
  // スマホ実機確認・デモでトンネル (cloudflared) や LAN IP 経由で開くため許可する。
  allowedDevOrigins: ["*.trycloudflare.com", "*.ngrok-free.app", "192.168.0.0/16"],
};

export default nextConfig;
