import { PowerSyncDatabase, WASQLiteOpenFactory } from "@powersync/web";
import { AppSchema } from "./schema";

function createDatabase(): PowerSyncDatabase | null {
  if (typeof window === "undefined") return null;

  const factory = new WASQLiteOpenFactory({
    dbFilename: "tironet.db",
    worker: "/@powersync/worker/WASQLiteDB.umd.js",
    flags: {
      // Single-tab mode avoids the need for SharedArrayBuffer / COOP+COEP headers.
      enableMultiTabs: false,
    },
  });

  return new PowerSyncDatabase({ schema: AppSchema, database: factory });
}

export const db = createDatabase();
