"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import { api } from "@/lib/api";

export interface Me {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "AGENT" | "VIEWER";
}

const MeContext = createContext<Me | null>(null);
export const useMe = () => useContext(MeContext);

const NAV = [
  { href: "/tickets", label: "Tickets", count: true },
  { href: "/customers", label: "Clients" },
  { href: "/stats", label: "Statistiques" },
  { href: "/knowledge", label: "Base de connaissances" },
  { href: "/settings", label: "Paramètres" },
  { href: "/users", label: "Utilisateurs", admin: true },
  { href: "/audit", label: "Journal", admin: true },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [pending, setPending] = useState<number | null>(null);

  useEffect(() => {
    api<Me>("/api/auth/me").then(setMe).catch(() => undefined);
  }, []);
  useEffect(() => {
    const load = () => api<{ total: number }>("/api/tickets?status=review&pageSize=1").then((r) => setPending(r.total)).catch(() => undefined);
    void load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [pathname]);

  if (!me) return <div className="empty">Chargement…</div>;

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <MeContext.Provider value={me}>
      <div className="layout">
        <aside className="sidebar">
          <div className="brand">
            Service client<span>Emails automatisés</span>
          </div>
          <nav className="nav">
            {NAV.filter((n) => !n.admin || me.role === "ADMIN").map((n) => (
              <Link key={n.href} href={n.href} className={pathname.startsWith(n.href) ? "active" : ""}>
                {n.label}
                {n.count && pending ? <span className="count" title="Tickets à valider">{pending}</span> : null}
              </Link>
            ))}
          </nav>
          <div className="user">
            <div>{me.name}</div>
            <div className="muted small">{me.email}</div>
            <button className="btn small" style={{ marginTop: 8 }} onClick={logout}>
              Se déconnecter
            </button>
          </div>
        </aside>
        <main className="main">{children}</main>
      </div>
    </MeContext.Provider>
  );
}

export function StatusBadge({ label, tone }: { label: string; tone?: string }) {
  return <span className={`badge ${tone ?? ""}`}>{label}</span>;
}
