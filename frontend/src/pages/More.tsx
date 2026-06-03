/** Mobile "More" — the secondary destinations + theme + sign out (sidebar on wide). */
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

const LINKS = [
  { to: "/activity", label: "Activity" },
  { to: "/onboarding", label: "Verification & tiers" },
  { to: "/credentials", label: "Credentials" },
  { to: "/agents", label: "Internal agents" },
  { to: "/permissions", label: "Connected agents" },
  { to: "/wallet", label: "On-chain wallet" },
];

export function More() {
  const navigate = useNavigate();
  const { me, logout } = useAuth();

  function toggleTheme() {
    const cur = document.documentElement.getAttribute("data-theme") ?? "dark";
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("bankai_theme", next);
  }

  return (
    <div className="page stack lg narrow" style={{ maxWidth: 560 }}>
      <div>
        <h1>More</h1>
        <p className="muted small" style={{ margin: 0 }}>{me?.email}</p>
      </div>
      <div className="card">
        {LINKS.map((l) => (
          <button key={l.to} className="menu-item" onClick={() => navigate(l.to)}>{l.label}</button>
        ))}
        <hr className="hr" />
        <button className="menu-item" onClick={toggleTheme}>Toggle theme</button>
        <button className="menu-item danger" onClick={() => { logout(); navigate("/login"); }}>Sign out</button>
      </div>
    </div>
  );
}
