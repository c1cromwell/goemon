/** Mobile "More" — the secondary destinations, grouped, + theme + sign out (sidebar on wide). */
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

const GROUPS: Array<{ title: string; links: Array<{ to: string; label: string }> }> = [
  {
    title: "Money",
    links: [
      { to: "/add-cash", label: "Add cash" },
      { to: "/cash-out", label: "Cash out" },
      { to: "/earn", label: "Earn" },
      { to: "/borrow", label: "Borrow" },
      { to: "/bank", label: "Bank" },
      { to: "/cards", label: "Cards" },
      { to: "/bills", label: "Bills" },
      { to: "/requests", label: "Requests" },
      { to: "/send-abroad", label: "Send abroad" },
      { to: "/fx", label: "Currency exchange" },
      { to: "/pay", label: "Goemon Pay" },
      { to: "/escrow", label: "Escrow" },
    ],
  },
  {
    title: "Invest & collect",
    links: [
      { to: "/trade", label: "Trade" },
      { to: "/drops", label: "Drops" },
    ],
  },
  {
    title: "Trust & identity",
    links: [
      { to: "/self-custody", label: "Self-custody" },
      { to: "/wallet", label: "On-chain wallet" },
      { to: "/credentials", label: "Credentials" },
      { to: "/onboarding", label: "Verification & tiers" },
      { to: "/permissions", label: "Connected agents" },
      { to: "/agents", label: "Internal agents" },
    ],
  },
  {
    title: "Family",
    links: [
      { to: "/starter", label: "Starter (guardian)" },
      { to: "/starter/teen", label: "Starter (teen)" },
    ],
  },
  {
    title: "Account",
    links: [
      { to: "/activity", label: "Activity" },
      { to: "/console", label: "Console" },
    ],
  },
];

export function More() {
  const navigate = useNavigate();
  const { me, logout } = useAuth();

  function toggleTheme() {
    const cur = document.documentElement.getAttribute("data-theme") ?? "dark";
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
