// Campaign timing helpers shared by the owner manager and the member store.

/** Whether a campaign's end time has passed. Null end = never expires. */
export function isCampaignExpired(endsAt?: string | null): boolean {
  if (!endsAt) return false;
  return new Date(endsAt).getTime() <= Date.now();
}

/**
 * Human countdown to a campaign's end, e.g. "2d 5h left", "3h 12m left",
 * "8m left". Returns "Ended" once past, or null when there's no end date.
 * Pass `nowMs` (a ticking value) so callers re-render the countdown live.
 */
export function timeLeftLabel(endsAt?: string | null, nowMs: number = Date.now()): string | null {
  if (!endsAt) return null;
  const ms = new Date(endsAt).getTime() - nowMs;
  if (ms <= 0) return "Ended";

  const totalMinutes = Math.floor(ms / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `${days}d ${hours}h left`;
  if (hours > 0) return `${hours}h ${minutes}m left`;
  return `${Math.max(minutes, 1)}m left`;
}
