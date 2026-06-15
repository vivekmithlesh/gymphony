import { describe, it, expect } from "vitest";
import {
  resolveSubscription,
  planAllows,
  tierUnlocks,
  subscriptionHasFeature,
  normalizeTier,
  requiredTierFor,
  FEATURE_MIN_TIER,
  PLAN_RANK,
  type AppFeature,
  type SubscriptionLike,
} from "@/lib/plans";

const DAY = 24 * 60 * 60 * 1000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

describe("normalizeTier", () => {
  it("maps known tiers and legacy values", () => {
    expect(normalizeTier("pro")).toBe("pro");
    expect(normalizeTier("Growth")).toBe("growth");
    expect(normalizeTier("starter")).toBe("starter");
    expect(normalizeTier("free")).toBe("starter"); // legacy Free → starter
    expect(normalizeTier(null)).toBe("starter");
    expect(normalizeTier(undefined)).toBe("starter");
    expect(normalizeTier("nonsense")).toBe("starter");
  });
});

describe("resolveSubscription", () => {
  it("defaults an empty/missing row to starter/inactive (safe least-privilege)", () => {
    const r = resolveSubscription({});
    expect(r.tier).toBe("starter");
    expect(r.status).toBe("inactive");
  });

  it("boosts an active trial to Growth", () => {
    const r = resolveSubscription({ plan_status: "trial", trial_ends_at: iso(3 * DAY) });
    expect(r.tier).toBe("growth");
    expect(r.status).toBe("trial");
    expect(r.isTrial).toBe(true);
    expect(r.trialDaysLeft).toBeGreaterThan(0);
  });

  it("downgrades an expired trial to starter", () => {
    const r = resolveSubscription({ plan_status: "trial", trial_ends_at: iso(-DAY) });
    expect(r.tier).toBe("starter");
    expect(r.status).toBe("expired");
  });

  it("honors an active paid plan", () => {
    const r = resolveSubscription({ plan_tier: "pro", plan_status: "active", expiry_date: iso(10 * DAY) });
    expect(r.tier).toBe("pro");
    expect(r.status).toBe("active");
  });

  it("downgrades a lapsed paid plan to starter", () => {
    const r = resolveSubscription({ plan_tier: "pro", plan_status: "active", expiry_date: iso(-DAY) });
    expect(r.tier).toBe("starter");
    expect(r.status).toBe("expired");
  });
});

describe("tierUnlocks / FEATURE_MIN_TIER matrix", () => {
  const tiers = ["starter", "growth", "pro"] as const;
  const features = Object.keys(FEATURE_MIN_TIER) as AppFeature[];

  it("unlocks a feature iff the tier rank >= the feature's required rank", () => {
    for (const feature of features) {
      for (const tier of tiers) {
        const expected = PLAN_RANK[tier] >= PLAN_RANK[FEATURE_MIN_TIER[feature]];
        expect(tierUnlocks(tier, feature)).toBe(expected);
      }
    }
  });

  it("gates the Growth surfaces correctly (incl. the Wave-1 additions)", () => {
    for (const f of ["revenue_analytics", "leaderboard", "inventory_management", "whatsapp_reminders"] as AppFeature[]) {
      expect(tierUnlocks("starter", f)).toBe(false);
      expect(tierUnlocks("growth", f)).toBe(true);
      expect(tierUnlocks("pro", f)).toBe(true);
    }
  });

  it("gates Pro-only surfaces correctly", () => {
    for (const f of ["ai_features", "multi_staff", "multi_branch", "advanced_analytics"] as AppFeature[]) {
      expect(tierUnlocks("starter", f)).toBe(false);
      expect(tierUnlocks("growth", f)).toBe(false);
      expect(tierUnlocks("pro", f)).toBe(true);
    }
  });

  it("never gates baseline surfaces", () => {
    for (const f of ["dashboard", "members", "attendance", "kiosk"] as AppFeature[]) {
      expect(tierUnlocks("starter", f)).toBe(true);
    }
  });
});

describe("planAllows (trial/expiry-aware end-to-end)", () => {
  it("a trial gym can reach Growth features but not Pro features", () => {
    const trial: SubscriptionLike = { plan_status: "trial", trial_ends_at: iso(2 * DAY) };
    expect(planAllows(trial, "leaderboard")).toBe(true);
    expect(planAllows(trial, "inventory_management")).toBe(true);
    expect(planAllows(trial, "ai_features")).toBe(false);
  });

  it("an expired gym loses Growth features (graceful downgrade)", () => {
    const expired: SubscriptionLike = { plan_tier: "growth", plan_status: "active", expiry_date: iso(-DAY) };
    expect(planAllows(expired, "revenue_analytics")).toBe(false);
    expect(planAllows(expired, "members")).toBe(true); // baseline still works
  });

  it("a missing row defaults to starter (no accidental unlock)", () => {
    expect(planAllows(null, "revenue_analytics")).toBe(false);
    expect(planAllows(undefined, "ai_features")).toBe(false);
    expect(planAllows({}, "leaderboard")).toBe(false);
  });
});

describe("requiredTierFor & subscriptionHasFeature collision guard", () => {
  it("requiredTierFor returns the min tier from the SSOT map", () => {
    expect(requiredTierFor("leaderboard")).toBe("growth");
    expect(requiredTierFor("ai_features")).toBe("pro");
    expect(requiredTierFor("members")).toBe("starter");
  });

  it("the marketing `advanced_analytics` Feature resolves at Growth (distinct namespace from the Pro AppFeature)", () => {
    // Regression guard for the documented enum collision: the marketing Feature
    // is a Growth capability, while the AppFeature of the same name is Pro.
    expect(subscriptionHasFeature({ plan_tier: "growth", plan_status: "active", expiry_date: iso(DAY) }, "advanced_analytics")).toBe(true);
    expect(tierUnlocks("growth", "advanced_analytics")).toBe(false); // AppFeature = Pro
  });
});
