// 認証画面 (login / register / verify) — ヘッダーなし・中央カードレイアウト
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto min-h-screen w-full max-w-[480px] bg-gray-50">
      {children}
    </div>
  );
}
