"use client";

import { logoutAction } from "../app/actions/auth";

export function LogoutButton() {
  return (
    <form action={logoutAction}>
      <button
        type="submit"
        className="tag"
        style={{
          background: "transparent",
          border: "1px solid var(--border-warn)",
          color: "var(--border-warn)",
          cursor: "pointer",
          fontFamily: "var(--font-mono)",
        }}
        title="Clear saved API key and return to login"
      >
        LOG OUT
      </button>
    </form>
  );
}