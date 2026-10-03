import type { PosRoute } from "./routes";

const paths: Record<Exclude<PosRoute, "settings">, string> = {
  sell: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
  orders: "M6 3h12v18l-3-2-3 2-3-2-3 2V3zM9 7h6M9 11h6M9 15h4",
  customers: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M13 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
  returns: "M9 4 4 9l5 5M4 9h10a6 6 0 0 1 0 12h-2",
  register: "M4 3h16v18H4zM7 6h10v4H7zM7 14h2M13 14h4M7 18h2M13 18h4",
  health: "M3 12h4l3-7 4 14 3-7h4",
  attention: "M10.3 3.9 2.2 18a2 2 0 0 0 1.7 3h16.2a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 8v5M12 17h.01",
};

export function NavIcon({ route }: { readonly route: PosRoute }) {
  if (route === "settings") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <path d="m9.5 3-.6 2.4-1.8 1-2.4-.7-2.5 4.3L4 11.7v2.1l-1.8 1.7 2.5 4.3 2.4-.7 1.8 1 .6 2.4h5l.6-2.4 1.8-1 2.4.7 2.5-4.3-1.8-1.7v-2.1l1.8-1.7-2.5-4.3-2.4.7-1.8-1-.6-2.4h-5z" />
        <circle cx="12" cy="12.75" r="3.25" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={paths[route]} />
    </svg>
  );
}
