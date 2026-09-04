import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: ["./src/schema.ts", "./src/likes-schema.ts"],
  out: "./drizzle",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgresql://photostream:local-development-only@127.0.0.1:5432/photostream",
  },
  strict: true,
  verbose: true,
});
