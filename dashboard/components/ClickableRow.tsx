"use client";
import { useRouter } from "next/navigation";
import { ReactNode } from "react";

export function ClickableRow({ href, children, label = "Open run details" }: { href: string; children: ReactNode; label?: string }) {
  const router = useRouter();
  const navigate = () => router.push(href);
  return (
    <tr 
      className="interactive-row" 
      onClick={navigate}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          navigate();
        }
      }}
      tabIndex={0}
      role="link"
      aria-label={label}
      style={{ cursor: "pointer" }}
    >
      {children}
    </tr>
  );
}
