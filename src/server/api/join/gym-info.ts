import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getPublicGymInfo } from "@/server/services/join.service";

const gymInfoSchema = z.object({
  gymId: z.string().min(1),
});

/**
 * Public (unauthenticated) endpoint that powers the Join Gym onboarding page.
 * Returns gym branding + active plans, or success:false for an invalid /
 * expired / deleted gym link.
 */
export const joinGymInfo = createServerFn({ method: "POST" })
  .inputValidator(gymInfoSchema)
  .handler(async ({ data }) => {
    const gym = await getPublicGymInfo(data.gymId);

    if (!gym) {
      return {
        success: false as const,
        message: "This gym link is invalid or no longer available.",
        gym: null,
      };
    }

    return { success: true as const, message: "ok", gym };
  });
