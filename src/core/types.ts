export type TaskStatus = "pending" | "in_progress" | "blocked" | "completed";
export type PackStatus = "no_tasks" | "pending" | "in_progress" | "blocked" | "completed";
export type GitRefresh = "auto" | "always" | "never";

export interface SourceInfo {
  kind: "file" | "directory" | "glob" | "git";
  path?: string;
  url?: string;
  requestedRef?: string;
  resolvedRef?: string;
  resolvedCommit?: string;
  repoHash?: string;
}

export interface PackTask {
  id: string;
  sourceId?: string;
  title: string;
  category?: string;
  body?: string;
  doneWhen?: string[];
  status: TaskStatus;
  notes: string[];
  source?: SourceInfo;
  startedAt?: string;
  completedAt?: string;
  blockedAt?: string;
}

export interface PackReference {
  id: string;
  name: string;
  description?: string;
  source: SourceInfo;
  path?: string;
  rootPath?: string;
  files?: string[];
}

export interface PackSkill {
  id: string;
  name: string;
  description?: string;
  source: SourceInfo;
  path: string;
}

export interface TaskCounts {
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
  blocked: number;
}

export interface PackContract {
  do?: string[];
  dont?: string[];
}

export interface PackState {
  schemaVersion: 1;
  id: string;
  name?: string;
  status: PackStatus;
  createdAt: string;
  updatedAt: string;
  repoRoot: string;
  prompt?: string;
  instructions?: string;
  taskCounts: TaskCounts;
  tasks: PackTask[];
  references: PackReference[];
  skills: PackSkill[];
  contract?: PackContract;
}

export interface ManifestTask {
  id?: string;
  title?: string;
  category?: string;
  body?: string;
  doneWhen?: string[];
  source?: SourceInfo;
}

export interface ManifestReference {
  name?: string;
  description?: string;
  ref: string;
}

export interface ManifestSkill {
  name?: string;
  description?: string;
  ref: string;
}

export interface PackManifest {
  schemaVersion?: number;
  name?: string;
  instructions?: string;
  tasks?: ManifestTask[];
  references?: ManifestReference[];
  skills?: ManifestSkill[];
  contract?: PackContract;
}

export interface InitInput {
  id?: string;
  name?: string;
  manifests: string[];
  instructionFiles: string[];
  taskRefs: string[];
  adHocTasks: string[];
  referenceRefs: ManifestReference[];
  skillRefs: ManifestSkill[];
  prompt?: string;
  stateDir?: string;
  gitRefresh: GitRefresh;
  json?: boolean;
  strict?: boolean;
}

export interface RuntimePaths {
  cwd: string;
  repoRoot: string;
  stateDir: string;
  cacheDir: string;
  gitCacheDir: string;
  packDir: string;
  eventDir: string;
  lockDir: string;
  indexPath: string;
}
