"use client";

export default function GlobalError({ reset }: Readonly<{ reset: () => void }>) {
  return (
    <html lang="zh-CN" style={{ colorScheme: "light dark" }}>
      <body
        style={{
          background: "Canvas",
          color: "CanvasText",
          fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
          margin: 0,
        }}
      >
        <main
          style={{
            display: "grid",
            minHeight: "100dvh",
            placeItems: "center",
            padding: "24px",
          }}
        >
          <div style={{ maxWidth: "28rem", textAlign: "center" }}>
            <h1 style={{ fontSize: "1.5rem", margin: 0 }}>服务暂时不可用</h1>
            <p style={{ margin: "12px 0 20px" }}>请稍后重试。</p>
            <button
              onClick={reset}
              style={{
                background: "ButtonFace",
                border: "1px solid ButtonBorder",
                borderRadius: "8px",
                color: "ButtonText",
                cursor: "pointer",
                minHeight: "44px",
                padding: "0 16px",
              }}
              type="button"
            >
              重试
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
