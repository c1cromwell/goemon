/**
 * Secondary navigation — the single source of truth for the destinations that
 * live behind "More". Shared by the desktop profile popup (Layout) and the
 * mobile More page so the two never drift apart.
 */
export interface NavLinkItem {
  to: string;
  label: string;
}
export interface NavGroup {
  title: string;
  links: NavLinkItem[];
}

export const SECONDARY_GROUPS: NavGroup[] = [
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
      { to: "/watchlist", label: "Watchlist" },
      { to: "/trade", label: "Trade" },
      { to: "/drops", label: "Drops" },
      { to: "/issuer", label: "Tokenize" },
      { to: "/portfolio", label: "Portfolio" },
      { to: "/equity", label: "My equity" },
      { to: "/raise", label: "Raise" },
      { to: "/exchange", label: "Exchange" },
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
