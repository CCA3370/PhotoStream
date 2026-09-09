import assert from "node:assert/strict";

import { backupFileName, planBackupRetention } from "./lib/backup-retention.mjs";

const names = [];
for (let offset = 0; offset < 80; offset += 1) {
  const date = new Date(Date.UTC(2026, 8, 10 - offset, 3, 0, 0));
  names.push(backupFileName(date));
}
names.push("photostream-not-a-backup.txt");
names.push("notes.pstrbk");

const plan = planBackupRetention(names);
assert.equal(plan.keep.length, 22, "14 daily plus 8 older weekly backups must be retained");
assert.equal(plan.remove.length, 58, "all other recognized snapshots must be pruned");
assert.deepEqual(plan.ignored.sort(), ["notes.pstrbk", "photostream-not-a-backup.txt"]);
assert.equal(plan.keep[0], "photostream-20260910T030000Z.pstrbk");
assert.ok(plan.keep.includes("photostream-20260827T030000Z.pstrbk"));
assert.ok(plan.remove.includes("photostream-20260826T030000Z.pstrbk"));

const duplicates = planBackupRetention([
  "photostream-20260910T030000Z.pstrbk",
  "photostream-20260910T020000Z.pstrbk",
  "photostream-20260909T030000Z.pstrbk",
]);
assert.deepEqual(duplicates.keep, [
  "photostream-20260910T030000Z.pstrbk",
  "photostream-20260909T030000Z.pstrbk",
]);
assert.deepEqual(duplicates.remove, ["photostream-20260910T020000Z.pstrbk"]);

assert.throws(() => planBackupRetention([], { dailyCount: 0 }), /dailyCount/u);
assert.throws(() => backupFileName(new Date(Number.NaN)), /valid/u);

process.stdout.write("Backup retention guard passed.\n");
