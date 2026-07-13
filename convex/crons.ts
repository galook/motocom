import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.daily(
  "clean expired ride rooms",
  { hourUTC: 3, minuteUTC: 15 },
  internal.maintenance.cleanupExpiredData,
);

export default crons;
