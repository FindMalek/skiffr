export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main id="main" tabIndex={-1} className="grid min-h-dvh place-items-center px-4 outline-none">
      <div className="w-full max-w-sm">{children}</div>
    </main>
  )
}
