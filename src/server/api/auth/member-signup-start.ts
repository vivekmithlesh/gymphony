import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { sendMemberSignupOtp } from "@/server/services/auth.service";

const memberSignupStartSchema = z.object({
  fullName: z.string().min(2).max(80),
  phone: z.string().regex(/^[6-9]\d{9}$/),
  gymId: z.string().uuid(),
});

export const memberSignupStart = createServerFn({ method: "POST" })
  .inputValidator(memberSignupStartSchema)
  .handler(async ({ data }) => {
    return sendMemberSignupOtp(data);
  });
