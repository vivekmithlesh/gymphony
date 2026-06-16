import { createServerFn } from "@tanstack/react-start";
import { USER_ROLES } from "@/constants";
import { requireRole } from "@/server/auth/middleware";
import { prisma } from "@/server/db";
import type { JoinInviteLink } from "@/types/gym.types";

/**
 * Returns the shareable Join Gym link for the owner's gym. The client builds
 * the absolute URL (origin + joinPath) for QR rendering and copy-to-clipboard.
 */
export const joinInviteLink = createServerFn({ method: "GET" })
  .middleware([requireRole(USER_ROLES.OWNER, USER_ROLES.ADMIN, USER_ROLES.STAFF)])
  .handler(async ({ context }): Promise<JoinInviteLink> => {
    const gym = await prisma.gym.findUnique({
      where: { id: context.session.gymId },
      select: { id: true, name: true },
    });

    if (!gym) {
      throw new Error("Gym not found");
    }

    return {
      gymId: gym.id,
      gymName: gym.name,
      joinPath: `/join?gym=${gym.id}`,
    };
  });
