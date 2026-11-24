"use client";

import { MotionConfig } from "framer-motion";

/**
 * Honours the operating system's "reduce motion" setting for every Framer
 * Motion animation. The CSS `prefers-reduced-motion` block in globals.css
 * cannot reach inline transform animations, so this is the other half.
 */
export default function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
