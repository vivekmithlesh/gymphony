-- Track read/unread state for in-app notifications (badge count, mark-as-read).
ALTER TABLE "public"."notifications" ADD COLUMN "read_at" TIMESTAMP(3);

-- Index to count/list unread notifications per gym efficiently.
CREATE INDEX "notifications_gym_id_read_at_idx" ON "public"."notifications"("gym_id", "read_at");
