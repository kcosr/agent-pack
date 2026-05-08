export type TaskStatus = "pending" | "in_progress" | "blocked" | "completed";
export type PackStatus = "no_tasks" | "pending" | "in_progress" | "blocked" | "completed";
export type GitRefresh = "auto" | "always" | "never";

export type SourceInfo =
  | FileSourceInfo
  | DirectorySourceInfo
  | GlobSourceInfo
  | GitSourceInfo
  | UrlSourceInfo;

export interface FileSourceInfo {
  kind: "file";
  path: string;
}

export interface DirectorySourceInfo {
  kind: "directory";
  path: string;
}

export interface GlobSourceInfo {
  kind: "glob";
  path: string;
}

export interface GitSourceInfo {
  kind: "git";
  url: string;
  requestedRef?: string;
  resolvedRef: string;
  resolvedCommit: string;
  repoHash: string;
  path?: string;
}

export interface UrlSourceInfo {
  kind: "url";
  url: string;
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
  tasks?: Array<ManifestTask | string>;
  references?: Array<ManifestReference | string>;
  skills?: Array<ManifestSkill | string>;
  contract?: PackContract;
}

export type InitInclude =
  | { type: "manifest"; ref: string }
  | { type: "instructions"; path: string }
  | { type: "taskRef"; ref: string }
  | { type: "adHocTask"; text: string }
  | { type: "reference"; ref: ManifestReference }
  | { type: "skill"; ref: ManifestSkill };

export interface InitInput {
  id?: string;
  name?: string;
  includes: InitInclude[];
  prompt?: string;
  stateDir?: string;
  gitRefresh: GitRefresh;
  json?: boolean;
}

export interface RuntimePaths {
  cwd: string;
  repoRoot: string;
  configDir: string;
  stateDir: string;
  cacheDir: string;
  gitCacheDir: string;
  packDir: string;
  eventDir: string;
  lockDir: string;
  indexPath: string;
}

export type SystemStatus = RuntimePaths & {
  defaultPackId?: string;
};

export interface CleanResult {
  packIds: string[];
  repoHashes: string[];
  removed: string[];
}

export type CatalogType = "manifest" | "task" | "reference" | "skill";

export interface CatalogEntry {
  type: CatalogType;
  name: string;
  path: string;
}
