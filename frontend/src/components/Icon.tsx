/** Minimal line icons (type-led design — no emoji). Stroke = currentColor. */
type Name = "home" | "invest" | "collect" | "agent" | "menu" | "copy" | "check";

const PATHS: Record<Name, JSX.Element> = {
  home: (
    <>
      <path d="M3 10.5 12 4l9 6.5" />
      <path d="M5 9.5V20h14V9.5" />
    </>
  ),
  invest: (
    <>
      <path d="M4 17l5-5 3 3 7-7" />
      <path d="M16 5h4v4" />
    </>
  ),
  collect: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </>
  ),
  agent: (
    <>
      <path d="M4 5h16v10H9l-4 4V5z" />
      <circle cx="9.5" cy="10" r="0.6" fill="currentColor" />
      <circle cx="12" cy="10" r="0.6" fill="currentColor" />
      <circle cx="14.5" cy="10" r="0.6" fill="currentColor" />
    </>
  ),
  menu: (
    <>
      <circle cx="12" cy="5" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="19" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h8" />
    </>
  ),
  check: <path d="M4 12l5 5L20 6" />,
};

export function Icon({ name, size = 18 }: { name: Name; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
