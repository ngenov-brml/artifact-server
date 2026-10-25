import {mkdtemp, readdir, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";

import {unstable_dev, type Unstable_DevWorker} from "wrangler";
import {describe, expect, it} from "vitest";

const origin = "https://artifacts.example.test";

describe("Cloudflare cold start", () => {
  it("starts against a current schema without writing to D1", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artifact-server-cold-start-"));
    let worker = await startWorker(directory);
    try {
      expect((await worker.fetch(`${origin}/ready`)).status).toBe(200);
      await worker.stop();

      const database = new DatabaseSync(await findD1DatabaseFile(directory));
      try {
        database.exec(`
          CREATE TRIGGER refuse_schema_insert BEFORE INSERT ON artifact_server_schema
            BEGIN SELECT RAISE(ABORT, 'cold start wrote the schema version'); END;
          CREATE TRIGGER refuse_schema_update BEFORE UPDATE ON artifact_server_schema
            BEGIN SELECT RAISE(ABORT, 'cold start wrote the schema version'); END;
          CREATE TRIGGER refuse_project_insert BEFORE INSERT ON projects
            BEGIN SELECT RAISE(ABORT, 'cold start wrote the default project'); END;
        `);
      } finally {
        database.close();
      }

      worker = await startWorker(directory);
      expect((await worker.fetch(`${origin}/ready`)).status).toBe(200);
    } finally {
      await worker.stop();
      await rm(directory, {force: true, recursive: true});
    }
  }, 60_000);
});

function startWorker(persistenceDirectory: string): Promise<Unstable_DevWorker> {
  return unstable_dev("src/worker.ts", {
    bundle: true,
    config: "wrangler.test.jsonc",
    compatibilityDate: "2026-08-15",
    compatibilityFlags: ["nodejs_compat"],
    experimental: {
      d1Databases: [{
        binding: "ARTIFACT_SERVER_D1_DATABASE",
        database_id: "artifact-server-test-d1",
        database_name: "artifact-server-test-d1",
      }],
      disableExperimentalWarning: true,
      disableDevRegistry: true,
      testScheduled: true,
      watch: false,
    },
    inspect: false,
    local: true,
    logLevel: "error",
    persist: true,
    persistTo: persistenceDirectory,
    r2: [{
      binding: "ARTIFACT_SERVER_R2_BUCKET",
      bucket_name: "artifact-server-test-r2",
    }],
    vars: {
      ARTIFACT_SERVER_API_TOKEN: "cloudflare-test-api-token-0000000000000003",
      ARTIFACT_SERVER_BOOTSTRAP_ADMIN_EMAIL: "administrator@example.test",
      ARTIFACT_SERVER_CONTENT_DOMAIN: "content.example.test",
      ARTIFACT_SERVER_INSTALLATION_ID: "cloudflare-cold-start-test",
      ARTIFACT_SERVER_OIDC_CLIENT_ID: "cloudflare-worker-test",
      ARTIFACT_SERVER_OIDC_ISSUER: "https://identity.example.test",
      ARTIFACT_SERVER_ORIGIN: origin,
      ARTIFACT_SERVER_QUALIFICATION_MODE: "enabled",
      ARTIFACT_SERVER_REQUEST_LOG_SAMPLE_RATE: "0",
    },
  });
}

async function findD1DatabaseFile(directory: string): Promise<string> {
  const entries = await readdir(directory, {recursive: true, withFileTypes: true});
  const found = entries.find((entry) =>
    entry.isFile() && entry.name.endsWith(".sqlite") && entry.parentPath.includes("D1")
  );
  if (found === undefined) {
    throw new Error("The Worker did not persist a local D1 database file.");
  }
  return join(found.parentPath, found.name);
}
