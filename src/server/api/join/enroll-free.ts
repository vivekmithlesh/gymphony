import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { USER_ROLES } from "@/constants";
import { requireRole } from "@/server/auth/middleware";
import { enrollFreePlan } from "@/server/services/join.service";

const enrollFreeSchema = z.object({
  planId: z.string().uuid(),
});

/**
 * Activates a free / trial membership for the authenticated member at the gym
 * bound to their session. Paid plans use the Razorpay create-order/verify flow.
 */
export const joinEnrollFree = createServerFn({ method: "POST" })
  .middleware([requireRole(USER_ROLES.MEMBER)])
  .inputValidator(enrollFreeSchema)
  .handler(async ({ context, data }) => {
    return enrollFreePlan(context.session.gymId, context.session.userId, data.planId);
  });
