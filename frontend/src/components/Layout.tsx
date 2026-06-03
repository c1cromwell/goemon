/**
 * App shell — flat primary nav (Home · Invest · Collect · Agent), one IA rendered
 * per channel (sidebar on wide, bottom bar on narrow). Secondary destinations
 * live behind a quiet profile menu. Streak dot sits by the logo.
 */
import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { Icon } from "./Icon";

const PRIMARY = [
  { to: "/", label: "Home", icon: "home" as const, end: true },
  { to: "/invest", label: "Invest", icon: "invest" as const },
  { to: "/collect", label: "Collect", icon: "collect" as const },
  { to: "/agent", label: "Agent", icon: "agent" as const },
];

const SECONDARY = [
  { to: "/activity", label: "Activity" },
  { to: "/onboarding", label: "Verification & tiers" },
  { to: "/credentials", label: "Credentials" },
  { to: "/agents", label: "Internal agents" },
  { to: "/permissions", label: "Connected agents" },
  { to: "/wallet", label: "On-chain wallet" },
];

function useTheme(): [string, () => void] {
  const [theme, setTheme] = useState<string>(() => localStorage.getItem("bankai_theme") ?? "dark");
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("bankai_theme", theme);
  }, [theme]);
  return [theme, () => setTheme((t) => (t === "dark" ? "light" : "dark"))];
}

export function Layout() {
  const { me, logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [theme, toggleTheme] = useTheme();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function go(to: string) {
    setMenuOpen(false);
    navigate(to);
  }

  const profileMenu = menuOpen ? (
    <div className="menu-pop">
      <div className="micro" style={{ padding: "6px 11px" }}>
        {me?.email}
      </div>
      <hr className="hr" />
      {SECONDARY.map((s) => (
        <button key={s.to} className="menu-item" onClick={() => go(s.to)}>
          {s.label}
        </button>
      ))}
      <hr className="hr" />
      <button className="menu-item" onClick={toggleTheme}>
        Theme: {theme === "dark" ? "Dark" : "Light"}
      </button>
      <button
        className="menu-item danger"
        onClick={() => {
          logout();
          navigate("/login");
        }}
      >
        Sign out
      </button>
    </div>
  ) : null;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="mark">
            B<span className="streak-dot" title="Active streak" />
          </span>
          BankAI
        </div>

        {PRIMARY.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
          >
            <span className="ico">
              <Icon name={item.icon} />
            </span>
            {item.label}
          </NavLink>
        ))}

        <div className="nav-spacer" />

        <div className="menu" ref={menuRef}>
          <button className="nav-item" style={{ width: "100%" }} onClick={() => setMenuOpen((o) => !o)}>
            <span className="ico">
              <Icon name="menu" />
            </span>
            More
          </button>
          {profileMenu}
        </div>
      </aside>

      <main className="content">
        <Outlet />
      </main>

      {/* Mobile primary nav */}
      <nav className="bottom-nav">
        {PRIMARY.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
          >
            <span className="ico">
              <Icon name={item.icon} />
            </span>
            {item.label}
          </NavLink>
        ))}
        <button className="nav-item" onClick={() => navigate("/more")}>
          <span className="ico">
            <Icon name="menu" />
          </span>
          More
        </button>
      </nav>
    </div>
  );
}
