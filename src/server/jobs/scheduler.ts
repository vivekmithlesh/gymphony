import { MembershipStatus } from "@prisma/client";
import { Queue, Worker, type Job } from "bullmq";
import {
  addDays,
  addMilliseconds,
  addMinutes,
  differenceInCalendarDays,
  format,
  startOfDay,
} from "date-fns";
import { redis } from "@/server/cache";
import { notificationQueue, reminderQueue } from "@/server/jobs/queue";
import { prisma } from "@/server/db";
import type { MembershipReminderJobData, NotificationJobData } from "@/server/jobs/job-types";

const IST_OFFSET_MINUTES = 330;
const EXPIRY_CHECK_SCHEDULER_ID = "daily-expiry-check";
const OVERDUE_UPDATE_SCHEDULER_ID = "daily-overdue-update";

type SchedulerJobName = typeof EXPIRY_CHECK_SCHEDULER_ID | typeof OVERDUE_UPDATE_SCHEDULER_ID;

type SchedulerJobData = {
  schedulerId: SchedulerJobName;
};

type GlobalSchedulerRegistry = typeof globalThis & {
  __gymSchedulerQueue__?: Queue<SchedulerJobData, void, SchedulerJobName>;
  __gymSchedulerWorker__?: Worker<SchedulerJobData, void, SchedulerJobName>;
  __gymSchedulerStartPromise__?: Promise<void>;
};

const globalForScheduler = globalThis as GlobalSchedulerRegistry;

function getIstDayWindow(
  baseDate: Date,
  dayOffset = 0,
): {
  start: Date;
  end: Date;
} {
  const istDate = addMinutes(baseDate, IST_OFFSET_MINUTES);
  const istDayStart = addDays(startOfDay(istDate), dayOffset);
  const utcWindowStart = addMinutes(istDayStart, -IST_OFFSET_MINUTES);
  const utcWindowEnd = addMilliseconds(addDays(utcWindowStart, 1), -1);

  return {
    start: utcWindowStart,
    end: utcWindowEnd,
  };
}

async function queueExpiryReminders(): Promise<void> {
  const today = new Date();
  const reminderWindows = [7, 3, 1].map((daysUntilExpiry) => ({
    daysUntilExpiry,
    ...getIstDayWindow(today, daysUntilExpiry),
  }));

  const memberships = await prisma.membership.findMany({
    where: {
      status: MembershipStatus.ACTIVE,
      OR: reminderWindows.map((window) => ({
        expiryDate: {
          gte: window.start,
          lte: window.end,
        },
      })),
    },
    select: {
      id: true,
      gymId: true,
      memberUserId: true,
      planName: true,
      expiryDate: true,
      memberUser: {
        select: {
          fullName: true,
          phone: true,
        },
      },
    },
  });

  if (memberships.length === 0) {
    console.info("[jobs:scheduler] No expiring memberships found for reminder run");
    return;
  }

  const jobs = memberships
    .map((membership) => {
      const matchedWindow = reminderWindows.find(
        (window) => membership.expiryDate >= window.start && membership.expiryDate <= window.end,
      );

      if (!matchedWindow) {
        return null;
      }

      const jobData: MembershipReminderJobData = {
        gymId: membership.gymId,
        memberUserId: membership.memberUserId,
        membershipId: membership.id,
        memberName: membership.memberUser.fullName,
        phone: membership.memberUser.phone,
        planName: membership.planName,
        daysUntilExpiry: matchedWindow.daysUntilExpiry,
      };

      return {
        name: "membership-reminder" as const,
        data: jobData,
        opts: {
          jobId: `membership-reminder:${membership.id}:${format(
            membership.expiryDate,
            "yyyy-MM-dd",
          )}:${matchedWindow.daysUntilExpiry}`,
        },
      };
    })
    .filter(
      (
        job,
      ): job is {
        name: "membership-reminder";
        data: MembershipReminderJobData;
        opts: { jobId: string };
      } => job !== null,
    );

  if (jobs.length > 0) {
    await reminderQueue.addBulk(jobs);
  }

  console.info("[jobs:scheduler] Queued membership reminders", {
    count: jobs.length,
  });
}

async function updateOverdueMemberships(): Promise<void> {
  const todayWindow = getIstDayWindow(new Date());

  const membershipsToMarkOverdue = await prisma.membership.findMany({
    where: {
      status: MembershipStatus.ACTIVE,
      expiryDate: {
        lt: todayWindow.start,
      },
    },
    select: {
      id: true,
      gymId: true,
    },
  });

  if (membershipsToMarkOverdue.length === 0) {
    console.info("[jobs:scheduler] No memberships to mark overdue");
    return;
  }

  await prisma.membership.updateMany({
    where: {
      id: {
        in: membershipsToMarkOverdue.map((membership) => membership.id),
      },
    },
    data: {
      status: MembershipStatus.OVERDUE,
    },
  });

  const gymCounts = membershipsToMarkOverdue.reduce<Map<string, number>>((counts, membership) => {
    counts.set(membership.gymId, (counts.get(membership.gymId) ?? 0) + 1);
    return counts;
  }, new Map());

  const jobs = Array.from(gymCounts.entries()).map(([gymId, overdueCount]) => {
    const jobData: NotificationJobData = {
      gymId,
      text: `${overdueCount} membership(s) were marked overdue after the daily expiry check.`,
      type: "warning",
      color: "amber-500",
    };

    return {
      name: "overdue-update" as const,
      data: jobData,
      opts: {
        jobId: `overdue-update:${gymId}:${format(todayWindow.start, "yyyy-MM-dd")}:${differenceInCalendarDays(new Date(), todayWindow.start)}`,
      },
    };
  });

  await notificationQueue.addBulk(jobs);

  console.info("[jobs:scheduler] Updated overdue memberships", {
    membershipsUpdated: membershipsToMarkOverdue.length,
    gymsNotified: jobs.length,
  });
}

async function processSchedulerJob(
  job: Job<SchedulerJobData, void, SchedulerJobName>,
): Promise<void> {
  if (job.name === EXPIRY_CHECK_SCHEDULER_ID) {
    await queueExpiryReminders();
    return;
  }

  if (job.name === OVERDUE_UPDATE_SCHEDULER_ID) {
    await updateOverdueMemberships();
  }
}

function getSchedulerQueue(): Queue<SchedulerJobData, void, SchedulerJobName> {
  if (globalForScheduler.__gymSchedulerQueue__) {
    return globalForScheduler.__gymSchedulerQueue__;
  }

  const queue = new Queue<SchedulerJobData, void, SchedulerJobName>("gym-scheduler", {
    connection: redis,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 5000,
      },
    },
  });

  if (process.env.NODE_ENV !== "production") {
    globalForScheduler.__gymSchedulerQueue__ = queue;
  }

  return queue;
}

function getSchedulerWorker(): Worker<SchedulerJobData, void, SchedulerJobName> {
  if (globalForScheduler.__gymSchedulerWorker__) {
    return globalForScheduler.__gymSchedulerWorker__;
  }

  const worker = new Worker<SchedulerJobData, void, SchedulerJobName>(
    "gym-scheduler",
    processSchedulerJob,
    {
      connection: redis.duplicate(),
      concurrency: 1,
    },
  );

  worker.on("failed", (job, error) => {
    console.error("[jobs:scheduler] Scheduler job failed", {
      jobId: job?.id,
      name: job?.name,
      error: error.message,
    });
  });

  if (process.env.NODE_ENV !== "production") {
    globalForScheduler.__gymSchedulerWorker__ = worker;
  }

  return worker;
}

export async function startScheduler(): Promise<void> {
  if (globalForScheduler.__gymSchedulerStartPromise__) {
    return globalForScheduler.__gymSchedulerStartPromise__;
  }

  globalForScheduler.__gymSchedulerStartPromise__ = (async () => {
    const schedulerQueue = getSchedulerQueue();
    getSchedulerWorker();

    await schedulerQueue.upsertJobScheduler(
      EXPIRY_CHECK_SCHEDULER_ID,
      {
        pattern: "0 3 * * *",
      },
      {
        name: EXPIRY_CHECK_SCHEDULER_ID,
        data: {
          schedulerId: EXPIRY_CHECK_SCHEDULER_ID,
        },
      },
    );

    await schedulerQueue.upsertJobScheduler(
      OVERDUE_UPDATE_SCHEDULER_ID,
      {
        pattern: "30 18 * * *",
      },
      {
        name: OVERDUE_UPDATE_SCHEDULER_ID,
        data: {
          schedulerId: OVERDUE_UPDATE_SCHEDULER_ID,
        },
      },
    );

    console.info("[jobs:scheduler] Repeat schedules registered");
  })();

  return globalForScheduler.__gymSchedulerStartPromise__;
}
