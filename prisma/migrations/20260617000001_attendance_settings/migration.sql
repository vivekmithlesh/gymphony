-- Configurable attendance controls per gym.
ALTER TABLE "public"."gym_settings"
  ADD COLUMN "attendance_cooldown_minutes" INTEGER NOT NULL DEFAULT 360,
  ADD COLUMN "late_check_in_hour" INTEGER NOT NULL DEFAULT 22;
