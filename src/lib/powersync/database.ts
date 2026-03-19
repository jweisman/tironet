import {
  PowerSyncDatabase,
  WASQLiteOpenFactory,
  WASQLiteVFS,
} from "@powersync/web";
import { AppSchema } from "./schema";

function createDatabase(): PowerSyncDatabase | null {
  if (typeof window === "undefined") return null;

  // Use OPFSCoopSyncVFS instead of the default IDBBatchAtomicVFS.
  // IDBBatchAtomicVFS causes stack overflows and WASM memory crashes on
  // iOS Safari (WebKit gigacage exhaustion — WebKit bug 269937).
  // OPFSCoopSyncVFS uses the Origin Private File System API which is
  // faster and avoids the IndexedDB-related crash path.
  const factory = new WASQLiteOpenFactory({
    dbFilename: "tironet.db",
    vfs: WASQLiteVFS.OPFSCoopSyncVFS,
    worker: "/@powersync/worker/WASQLiteDB.umd.js",
    flags: {
      // Single-tab mode avoids the need for SharedArrayBuffer / COOP+COEP headers.
      enableMultiTabs: false,
    },
  });

  return new PowerSyncDatabase({
    schema: AppSchema,
    database: factory,
    // Use pre-built UMD sync worker — prevents Turbopack from trying to bundle it.
    sync: { worker: "/@powersync/worker/SharedSyncImplementation.umd.js" },
  });
}

export const db = createDatabase();
