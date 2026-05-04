import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Returns the initials for a gym name (up to 2 characters).
 * Falls back to "G" (for Gym) when the name is empty.
 */
export function getGymInitials(name: string): string {
  if (!name?.trim()) return "G";
  const words = name.trim().split(/\s+/);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}
