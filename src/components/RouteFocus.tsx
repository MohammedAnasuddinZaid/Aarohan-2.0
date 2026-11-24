"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * Client-side route-change accessibility.
 *
 *  - Moves keyboard focus to the main landmark so the next Tab continues from
 *    the new page instead of the top nav.
 *  - Announces the new page's first heading to screen readers through a polite
 *    live region (client navigations do not otherwise announce anything).
 *
 * The very first render is skipped so we do not hijack focus on initial load.
 */
export default function RouteFocus() {
  const pathname = usePathname();
  const firstRender = useRef(true);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const raf = window.requestAnimationFrame(() => {
      const main = document.getElementById("main-content");
      const heading = main?.querySelector("h1")?.textContent?.trim();
      if (heading) setAnnouncement(heading);
      main?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(raf);
  }, [pathname]);

  return (
    <p role="status" aria-live="polite" className="sr-only">
      {announcement}
    </p>
  );
}
