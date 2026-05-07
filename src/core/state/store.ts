import path from "node:path";
import { AgentPackError } from "../errors.js";
import { appendJsonLine, ensureDir, pathExists, readJson, writeJson } from "../fs.js";
import { resolveRuntimePaths } from "../paths.js";
import type { PackState, RuntimePaths } from "../types.js";
import { derivePackStatus, taskCounts } from "./status.js";

export interface PackIndexEntry {
  id: string;
  name?: string;
  status: string;
  updatedAt: string;
  path: string;
}

export interface PackIndex {
  schemaVersion: 1;
  packs: Record<string, PackIndexEntry>;
}

export class StateStore {
  readonly paths: RuntimePaths;

  constructor(options: { cwd?: string; stateDir?: string } = {}) {
    this.paths = resolveRuntimePaths(options);
  }

  async ensure(): Promise<void> {
    await ensureDir(this.paths.packDir);
    await ensureDir(this.paths.eventDir);
  }

  packPath(id: string): string {
    return path.join(this.paths.packDir, `${id}.json`);
  }

  eventPath(id: string): string {
    return path.join(this.paths.eventDir, `${id}.jsonl`);
  }

  async loadIndex(): Promise<PackIndex> {
    return readJson<PackIndex>(this.paths.indexPath, { schemaVersion: 1, packs: {} });
  }

  async saveIndex(index: PackIndex): Promise<void> {
    await writeJson(this.paths.indexPath, index);
  }

  async listPacks(): Promise<PackState[]> {
    const index = await this.loadIndex();
    const packs: PackState[] = [];
    for (const id of Object.keys(index.packs).sort()) {
      packs.push(await this.loadPack(id));
    }
    return packs;
  }

  async loadPack(id?: string): Promise<PackState> {
    const packId = id ?? process.env.AGENT_PACK_ID;
    if (!packId) {
      throw new AgentPackError("pack id is required; pass --id or set AGENT_PACK_ID");
    }
    const filePath = this.packPath(packId);
    if (!(await pathExists(filePath))) {
      throw new AgentPackError(`pack not found: ${packId}`);
    }
    return readJson<PackState>(filePath, undefined as never);
  }

  async createPack(pack: PackState): Promise<void> {
    await this.ensure();
    if (await pathExists(this.packPath(pack.id))) {
      throw new AgentPackError(`pack already exists: ${pack.id}`);
    }
    await this.savePack(pack, "pack.created");
  }

  async savePack(pack: PackState, eventType?: string, eventData: unknown = {}): Promise<void> {
    await this.ensure();
    const now = new Date().toISOString();
    pack.updatedAt = eventType === "pack.created" ? pack.updatedAt : now;
    pack.taskCounts = taskCounts(pack.tasks);
    pack.status = derivePackStatus(pack.tasks);
    await writeJson(this.packPath(pack.id), pack);
    const index = await this.loadIndex();
    index.packs[pack.id] = {
      id: pack.id,
      name: pack.name,
      status: pack.status,
      updatedAt: pack.updatedAt,
      path: path.relative(this.paths.repoRoot, this.packPath(pack.id)),
    };
    await this.saveIndex(index);
    if (eventType) {
      await appendJsonLine(this.eventPath(pack.id), {
        type: eventType,
        packId: pack.id,
        at: now,
        data: eventData,
      });
    }
  }
}
