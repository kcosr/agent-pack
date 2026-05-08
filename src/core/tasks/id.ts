export function formatTaskId(value: number): string {
  return `t${String(value).padStart(3, "0")}`;
}
