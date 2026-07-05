import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type HealthResponse = {
  ok: boolean;
  name: string;
  service: string;
  timestamp: string;
};

type ProfileResponse = {
  appName: string;
  mode: string;
  message: string;
};

function getApiBaseUrl() {
  return window.foundConfig?.apiBaseUrl ?? import.meta.env.VITE_API_BASE_URL ?? "";
}

function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const apiBaseUrl = getApiBaseUrl();

    Promise.all([
      fetch(`${apiBaseUrl}/api/health`).then((response) => response.json()),
      fetch(`${apiBaseUrl}/api/profile`).then((response) => response.json())
    ])
      .then(([healthData, profileData]) => {
        setHealth(healthData);
        setProfile(profileData);
      })
      .catch((requestError: Error) => {
        setError(requestError.message);
      });
  }, []);

  return (
    <main className="shell">
      <section className="panel">
        <p className="eyebrow">Personal macOS app</p>
        <h1>3.found</h1>
        <p className="lead">
          {profile?.message ?? "正在连接本地服务..."}
        </p>

        <div className="status-grid">
          <div className="status-item">
            <span>前端</span>
            <strong>已启动</strong>
          </div>
          <div className="status-item">
            <span>后端</span>
            <strong>{health?.ok ? "已连接" : "连接中"}</strong>
          </div>
          <div className="status-item">
            <span>桌面端</span>
            <strong>可打包</strong>
          </div>
        </div>

        {health ? (
          <p className="meta">
            API：{health.service} · {new Date(health.timestamp).toLocaleString()}
          </p>
        ) : null}

        {error ? <p className="error">连接失败：{error}</p> : null}
      </section>
    </main>
  );
}

const root = document.getElementById("root");

if (!root) {
  throw new Error("未找到页面根节点");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);

