import clsx, { type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** clsx + tailwind-merge: later classes win, so a component's `className` overrides its defaults (w-20 beats w-full). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
