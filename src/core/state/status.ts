import { activeTasks } from "../inputs.js";
import type { PackStatus, PackTask, TaskCounts } from "../types.js";

export function taskCounts(tasks: PackTask[]): TaskCounts {
  const active = activeTasks(tasks);
  return {
    total: active.length,
    pending: active.filter((task) => task.status === "pending").length,
    inProgress: active.filter((task) => task.status === "in_progress").length,
    completed: active.filter((task) => task.status === "completed").length,
    blocked: active.filter((task) => task.status === "blocked").length,
  };
}

export function derivePackStatus(tasks: PackTask[]): PackStatus {
  const active = activeTasks(tasks);
  if (active.length === 0) {
    return "no_tasks";
  }
  if (active.every((task) => task.status === "completed")) {
    return "completed";
  }
  if (active.some((task) => task.status === "blocked")) {
    return "blocked";
  }
  if (active.some((task) => task.status === "in_progress" || task.status === "completed")) {
    return "in_progress";
  }
  return "pending";
}
