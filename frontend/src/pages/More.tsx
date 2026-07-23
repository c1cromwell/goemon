/** Mobile "More" — the secondary destinations, grouped, + theme + sign out (sidebar on wide). */
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { SECONDARY_GROUPS as GROUPS } from "../lib/nav";

export function More() {
  const navigate = useNavigate();
  const { me, logout } = useAuth();

  function toggleTheme() {
    const cur = document.documentElement.getAttribute("data-theme") ?? "light";
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("goemon_theme", next);
  }

  return (
    <div className="page stack lg narrow" style={{ maxWidth: 560 }}>
      <div>
        <h1>More</h1>
        <p className="muted small" style={{ margin: 0 }}>{me?.email}</p>
      </div>

      {GROUPS.map((g) => (
        <div key={g.title} className="stack sm">
          <span className="muted micro" style={{ textTransform: "uppercase", letterSpacing: "0.04em" }}>{g.title}</span>
          <div className="card">
            {g.links.map((l) => (
              <button key={l.to} className="menu-item" onClick={() => navigate(l.to)}>{l.label}</button>
            ))}
          </div>
        </div>
      ))}

      <div className="card">
        <button className="menu-item" onClick={toggleTheme}>Toggle theme</button>
        <button className="menu-item danger" onClick={() => { logout(); navigate("/login"); }}>Sign out</button>
      </div>
    </div>
  );
}
