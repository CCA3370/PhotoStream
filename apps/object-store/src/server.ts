import { resolve } from "node:path";

import { createObjectStoreServer } from "./app.js";
import { loadObjectStoreConfig } from "./config.js";

const config = loadObjectStoreConfig(process.env);
const server = createObjectStoreServer({
  appOrigin: config.APP_ORIGIN,
  secret: config.LOCAL_OBJECT_SECRET,
  storageRoot: resolve(config.OBJECT_STORE_ROOT),
});

server.listen(config.OBJECT_STORE_PORT, config.OBJECT_STORE_HOST, () => {
  process.stdout.write(
    `Local object store listening at http://${config.OBJECT_STORE_HOST}:${config.OBJECT_STORE_PORT}\n`,
  );
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => server.close());
}
