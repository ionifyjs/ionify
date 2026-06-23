import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { IonifyWatcher } from "../src/core/watcher";

const activeWatchers: IonifyWatcher[] = [];

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("IonifyWatcher", () => {
  afterEach(() => {
    for (const watcher of activeWatchers.splice(0)) {
      watcher.closeAll();
    }
  });

  it("suppresses delayed polling echoes for the same file version", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ionify-watch-"));
    const file = path.join(dir, "App.tsx");
    fs.writeFileSync(file, "export const value = 'a';\n");

    const watcher = new IonifyWatcher(dir);
    activeWatchers.push(watcher);
    const events: Array<{ file: string; status: string }> = [];
    watcher.on("change", (changedFile, status) => {
      events.push({ file: changedFile, status });
    });
    watcher.watchFile(file);

    fs.writeFileSync(file, "export const value = 'b';\n");
    await delay(5600);

    expect(events).toEqual([{ file, status: "changed" }]);

    fs.writeFileSync(file, "export const value = 'c';\n");
    await delay(250);

    expect(events).toEqual([
      { file, status: "changed" },
      { file, status: "changed" },
    ]);
  }, 8000);
});
