import type { PackStatus, PackTask, TaskCounts } from "../types.js";

export function taskCounts(tasks: PackTask[]): TaskCounts {
  return {
    total: tasks.length,
    pending: tasks.filter((task) => task.status === "pending").length,
    inProgress: tasks.filter((task) => task.status === "in_progress").length,
    completed: tasks.filter((task) => task.status === "completed").length,
    blocked: tasks.filter((task) => task.status === "blocked").length,
  };
}

export function derivePackStatus(tasks: PackTask[]): PackStatus {
  if (tasks.length === 0) {
    return "no_tasks";
  }
  if (tasks.every((task) => task.status === "completed")) {
    return "completed";
  }
  if (tasks.some((task) => task.status === "blocked")) {
    return "blocked";
  }
  if (tasks.some((task) => task.status === "in_progress" || task.status === "completed")) {
    return "in_progress";
  }
  return "pending";
}
