import Image from "next/image";
import Link from "next/link";
import { ThemeToggle } from "./theme-toggle";

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="shell header-inner">
        <Link href="/" className="brand" aria-label="IIC IT Helpdesk home">
          <Image src="/iic-logo.png" width={800} height={337} alt="Itahari International College, ING" priority />
          <span><strong>IT & NOC</strong><small>Helpdesk</small></span>
        </Link>
        <nav aria-label="Primary navigation">
          <Link href="#services">Services</Link>
          <Link href="#status">Status</Link>
          <Link href="/tickets/new" className="nav-action">Request support</Link>
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}
