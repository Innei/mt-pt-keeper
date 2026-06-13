import { writeFile } from "node:fs/promises";
import path from "node:path";

export type KeeperRunStatus = "success" | "expired" | "failed";

export interface AccountStats {
  downloaded?: string;
  uploaded?: string;
  ratio?: string;
}

export interface KeeperRunState {
  status: KeeperRunStatus;
  startedAt: string;
  finishedAt: string;
  url?: string;
  message: string;
  screenshotPath?: string;
  accountStats?: AccountStats;
}

export async function writeRunState(stateFile: string, state: KeeperRunState) {
  await writeFile(
    stateFile,
    `${JSON.stringify(state, null, 2)}\n`,
    "utf8",
  );
}

export function timestampForFile(date = new Date()) {
  return date.toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

export function screenshotPathFor(dir: string, startedAt: string) {
  return path.join(dir, `keeper-failure-${startedAt}.png`);
}
