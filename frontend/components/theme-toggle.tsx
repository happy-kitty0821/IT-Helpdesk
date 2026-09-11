"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

export function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("iic-theme");
    const initial = stored ? stored === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    setDark(initial);
    document.documentElement.dataset.theme = initial ? "dark" : "light";
  }, []);

  function toggleTheme() {
    const next = !dark;
    setDark(next);
    document.documentElement.dataset.theme = next ? "dark" : "light";
    localStorage.setItem("iic-theme", next ? "dark" : "light");
  }

  return (
    <button className="icon-button" type="button" onClick={toggleTheme} aria-label={`Switch to ${dark ? "light" : "dark"} theme`}>
      {dark ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
    </button>
  );
}
