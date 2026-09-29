import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import InviteAcceptancePage from "./page";

const root = document.getElementById("root");
if (!root) throw new Error("invite harness root is missing");
createRoot(root).render(
  <StrictMode>
    <InviteAcceptancePage />
  </StrictMode>,
);
