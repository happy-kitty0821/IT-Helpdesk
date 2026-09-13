"use client";

import { BookOpen, Boxes, CircleDot, Gauge, Home, LayoutGrid, LoaderCircle, ShieldAlert, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { AuthUser } from "@/lib/auth";

const navigation = [
  { href: "/admin", label: "Overview", icon: Gauge },
  { href: "/admin/tickets", label: "Tickets", icon: CircleDot },
  { href: "/admin/services", label: "Services", icon: LayoutGrid },
  { href: "/admin/guides", label: "Guides", icon: BookOpen },
  { href: "/admin/software", label: "Software", icon: Boxes },
  { href: "/admin/users", label: "Users", icon: Users },
];

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [state, setState] = useState<{ loading: boolean; user: AuthUser | null }>({ loading: true, user: null });

  useEffect(() => {
    fetch("/api/v1/auth/me/", { credentials: "include", cache: "no-store" })
      .then(async (response) => response.ok ? response.json() : null)
      .then((user) => setState({ loading: false, user }))
      .catch(() => setState({ loading: false, user: null }));
  }, []);

  if (state.loading) return <main className="admin-gate"><LoaderCircle className="spin" aria-hidden="true" /><p>Checking administrator access…</p></main>;
  if (!state.user) return <main className="admin-gate"><ShieldAlert aria-hidden="true" /><h1>Sign in required</h1><p>Use a superuser account to open the administration panel.</p><Link className="primary-button" href="/login">Sign in</Link></main>;
  if (!state.user.is_superuser) return <main className="admin-gate"><ShieldAlert aria-hidden="true" /><h1>Superuser access required</h1><p>Your account is signed in but cannot manage IIC content.</p><Link href="/">Return to helpdesk</Link></main>;

  return (
    <div className="admin-frame">
      <aside className="admin-sidebar">
        <Link href="/" className="admin-brand"><span>IIC</span><div><strong>IT & NOC</strong><small>Administration</small></div></Link>
        <nav aria-label="Administration">
          {navigation.map(({ href, label, icon: Icon }) => <Link key={href} href={href} className={pathname === href ? "active" : ""}><Icon aria-hidden="true" />{label}</Link>)}
        </nav>
        <div className="admin-user"><strong>{state.user.name}</strong><span>Superuser</span><Link href="/"><Home aria-hidden="true" /> Public helpdesk</Link></div>
      </aside>
      <main className="admin-main">{children}</main>
    </div>
  );
}
