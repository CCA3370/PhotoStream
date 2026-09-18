import { fileURLToPath } from "node:url";

import { createDatabase, createPool, migrateDatabase, schema } from "@photostream/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { MediaEditService } from "./edit-service.js";
import type { ObjectMetadata, ObjectStorage, SignedPut } from "./object-storage.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (databaseUrl !== undefined && new URL(databaseUrl).pathname !== "/photostream_test") {
  throw new Error("TEST_DATABASE_URL must target the dedicated photostream_test database");
}
const maybeDescribe = databaseUrl === undefined ? describe.skip : describe;

class FakeStorage implements ObjectStorage {
  readonly objects = new Map<string, ObjectMetadata>();

  signPut(options: {
    readonly key: string;
    readonly contentType: string;
    readonly bytes: number;
    readonly expiresAt: Date;
  }): SignedPut {
    return {
      url: `https://objects.invalid/${options.key}`,
      headers: { "content-type": options.contentType },
      expiresAt: options.expiresAt,
    };
  }

  signRead(options: { readonly key: string; readonly expiresAt: Date }): string {
    return `https://cdn.invalid/${options.key}?expires=${options.expiresAt.getTime()}`;
  }

  signMultipartPart(): SignedPut {
    throw new Error("not used");
  }

  async completeMultipart(): Promise<void> {
    throw new Error("not used");
  }

  async abortMultipart(): Promise<void> {}

  async head(key: string): Promise<ObjectMetadata | null> {
    return this.objects.get(key) ?? null;
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}

maybeDescribe("media edit revisions", () => {
  const pool = createPool(databaseUrl ?? "");
  const database = createDatabase(pool);
  const storage = new FakeStorage();
  const service = new MediaEditService({ database, storage });

  let reviewerId = "";
  let albumId = "";
  let mediaId = "";
  let originalVariantId = "";

  beforeAll(async () => {
    await migrateDatabase(
      pool,
      fileURLToPath(new URL("../../../../packages/db/drizzle", import.meta.url)),
    );
  });

  beforeEach(async () => {
    storage.objects.clear();
    await database.delete(schema.mediaEditStates);
    await database.delete(schema.mediaEditVariants);
    await database.delete(schema.mediaEditRevisions);
    await database.delete(schema.mediaVariants);
    await database.delete(schema.uploadParts);
    await database.delete(schema.uploadIntents);
    await database.delete(schema.media);
    await database.delete(schema.categories);
    await database.delete(schema.albums);
    await database.delete(schema.auditLogs);
    await database.delete(schema.sessions);
    await database.delete(schema.users);

    const [reviewer] = await database
      .insert(schema.users)
      .values({
        username: "reviewer-edit",
        normalizedUsername: "reviewer-edit",
        displayName: "修图审核员",
        role: "reviewer",
        passwordHash: "hash",
        mustChangePassword: false,
      })
      .returning({ id: schema.users.id });
    if (reviewer === undefined) throw new Error("reviewer insert failed");
    reviewerId = reviewer.id;

    const [album] = await database
      .insert(schema.albums)
      .values({
        slug: "edit-test",
        title: "Edit Test",
        state: "live",
        access: "public",
        idempotencyKey: "edit-test-album",
        createdBy: reviewerId,
      })
      .returning({ id: schema.albums.id });
    if (album === undefined) throw new Error("album insert failed");
    albumId = album.id;

    const [media] = await database
      .insert(schema.media)
      .values({
        albumId,
        uploaderId: reviewerId,
        ingestStatus: "uploading_source",
        publicationStatus: "hidden",
        width: 4_000,
        height: 3_000,
        mediaType: "image/jpeg",
        totalBytes: 4_000_000,
      })
      .returning({ id: schema.media.id });
    if (media === undefined) throw new Error("media insert failed");
    mediaId = media.id;

    const [original] = await database
      .insert(schema.mediaVariants)
      .values({
        mediaId,
        kind: "photo_original",
        objectKey: `media/albums/${albumId}/photos/${mediaId}/original.jpg`,
        format: "jpeg",
        contentType: "image/jpeg",
        width: 4_000,
        height: 3_000,
        expectedBytes: 4_000_000,
        verified: false,
      })
      .returning({ id: schema.mediaVariants.id });
    if (original === undefined) throw new Error("original insert failed");
    originalVariantId = original.id;
  });

  afterAll(async () => {
    await pool.end();
  });

  function createInput() {
    return {
      basedOnRevisionId: null,
      basedOnGeneration: 0,
      pipelineVersion: "local-edit-v2",
      recipeVersion: 2,
      recipeJson: { exposureEv: 0.2, denoiseStrength: 0, deblurStrength: 0 },
      denoiseModel: null,
      denoiseModelVersion: null,
      deblurModel: null,
      deblurModelVersion: null,
    };
  }

  function prepareInput() {
    return {
      variants: [
        {
          kind: "photo_480" as const,
          format: "webp" as const,
          contentType: "image/webp" as const,
          width: 480,
          height: 360,
          bytes: 20_000,
        },
        {
          kind: "photo_960" as const,
          format: "webp" as const,
          contentType: "image/webp" as const,
          width: 960,
          height: 720,
          bytes: 70_000,
        },
        {
          kind: "photo_1920" as const,
          format: "webp" as const,
          contentType: "image/webp" as const,
          width: 1_920,
          height: 1_440,
          bytes: 250_000,
        },
        {
          kind: "photo_download" as const,
          format: "jpeg" as const,
          contentType: "image/jpeg" as const,
          width: 4_000,
          height: 3_000,
          bytes: 3_500_000,
        },
      ],
    };
  }

  it("creates a pending revision and applies it only after all four objects verify", async () => {
    const created = await service.createRevision({
      actor: { id: reviewerId, role: "reviewer" },
      mediaId,
      input: createInput(),
      requestId: "edit-create-request",
    });
    expect(created.state.pendingRevisionId).not.toBeNull();
    expect(created.state.generation).toBe(1);
    const revisionId = created.state.pendingRevisionId;
    if (revisionId === null) throw new Error("pending revision missing");

    expect(created.pendingRevision?.status).toBe("rendering");

    await expect(
      service.completeRevision({
        actor: { id: reviewerId, role: "reviewer" },
        mediaId,
        revisionId,
        requestId: "edit-complete-too-early",
      }),
    ).rejects.toMatchObject({ code: "STATE_CONFLICT" });

    let variants = await database
      .select()
      .from(schema.mediaEditVariants)
      .where(eq(schema.mediaEditVariants.editRevisionId, revisionId));
    expect(variants).toHaveLength(0);

    const prepared = await service.prepareRevision({
      actor: { id: reviewerId, role: "reviewer" },
      mediaId,
      revisionId,
      input: prepareInput(),
      requestId: "edit-prepare-request",
    });
    expect(prepared.pendingRevision?.status).toBe("uploading");

    await expect(
      service.apply({
        actor: { id: reviewerId, role: "reviewer" },
        mediaId,
        revisionId,
        input: { expectedGeneration: 1, expectedActiveRevisionId: null },
        requestId: "edit-apply-before-ready",
      }),
    ).rejects.toMatchObject({ code: "STATE_CONFLICT" });
    expect((await service.getContext({ id: reviewerId, role: "reviewer" }, mediaId)).state).toMatchObject({
      activeRevisionId: null,
      pendingRevisionId: revisionId,
      generation: 1,
    });

    variants = await database
      .select()
      .from(schema.mediaEditVariants)
      .where(eq(schema.mediaEditVariants.editRevisionId, revisionId));
    expect(variants).toHaveLength(4);

    for (const variant of variants) {
      storage.objects.set(variant.objectKey, {
        bytes: variant.expectedBytes,
        contentType: variant.contentType,
        etag: `etag-${variant.kind}`,
      });
      await service.completeVariant({
        actor: { id: reviewerId, role: "reviewer" },
        mediaId,
        revisionId,
        kind: variant.kind,
      });
    }

    const ready = await service.completeRevision({
      actor: { id: reviewerId, role: "reviewer" },
      mediaId,
      revisionId,
      requestId: "edit-complete",
    });
    expect(ready.pendingRevision?.status).toBe("ready");

    const applied = await service.apply({
      actor: { id: reviewerId, role: "reviewer" },
      mediaId,
      revisionId,
      input: { expectedGeneration: 1, expectedActiveRevisionId: null },
      requestId: "edit-apply",
    });
    expect(applied.state).toMatchObject({
      activeRevisionId: revisionId,
      pendingRevisionId: null,
      generation: 2,
    });
    expect(applied.activeRevision?.status).toBe("active");
  });

  it("cleans discarded revision objects only after signed upload URLs expire", async () => {
    const created = await service.createRevision({
      actor: { id: reviewerId, role: "reviewer" },
      mediaId,
      input: createInput(),
      requestId: "edit-cleanup-create",
    });
    const revisionId = created.state.pendingRevisionId;
    if (revisionId === null) throw new Error("pending revision missing");

    await service.prepareRevision({
      actor: { id: reviewerId, role: "reviewer" },
      mediaId,
      revisionId,
      input: prepareInput(),
      requestId: "edit-cleanup-prepare",
    });
    const variants = await database
      .select()
      .from(schema.mediaEditVariants)
      .where(eq(schema.mediaEditVariants.editRevisionId, revisionId));
    for (const variant of variants) {
      storage.objects.set(variant.objectKey, {
        bytes: variant.expectedBytes,
        contentType: variant.contentType,
        etag: `cleanup-${variant.kind}`,
      });
    }

    const cancelledAt = new Date();
    await service.cancelPending({
      actor: { id: reviewerId, role: "reviewer" },
      mediaId,
      revisionId,
      requestId: "edit-cleanup-cancel",
    });

    expect(
      await service.cleanupDiscardedRevisions(
        100,
        new Date(cancelledAt.getTime() + 10 * 60 * 1_000),
      ),
    ).toBe(0);
    expect(storage.objects).toHaveLength(4);
    expect(
      await database
        .select()
        .from(schema.mediaEditRevisions)
        .where(eq(schema.mediaEditRevisions.id, revisionId)),
    ).toHaveLength(1);

    expect(
      await service.cleanupDiscardedRevisions(
        100,
        new Date(cancelledAt.getTime() + 21 * 60 * 1_000),
      ),
    ).toBe(1);
    expect(storage.objects).toHaveLength(0);
    expect(
      await database
        .select()
        .from(schema.mediaEditVariants)
        .where(eq(schema.mediaEditVariants.editRevisionId, revisionId)),
    ).toHaveLength(0);
    expect(
      await database
        .select()
        .from(schema.mediaEditRevisions)
        .where(eq(schema.mediaEditRevisions.id, revisionId)),
    ).toHaveLength(0);
  });

  it("keeps a failed revision pending until explicitly cancelled", async () => {
    const created = await service.createRevision({
      actor: { id: reviewerId, role: "reviewer" },
      mediaId,
      input: createInput(),
      requestId: "edit-failed-create",
    });
    const revisionId = created.state.pendingRevisionId;
    if (revisionId === null) throw new Error("pending revision missing");

    const failed = await service.failPending({
      actor: { id: reviewerId, role: "reviewer" },
      mediaId,
      revisionId,
      requestId: "edit-failed-mark",
    });
    expect(failed.state).toMatchObject({
      pendingRevisionId: revisionId,
      generation: 1,
      pendingStatus: "failed",
    });
    expect(failed.pendingRevision).toMatchObject({
      id: revisionId,
      status: "failed",
      failureCode: "CLIENT_PROCESSING_FAILED",
    });

    await expect(
      service.prepareRevision({
        actor: { id: reviewerId, role: "reviewer" },
        mediaId,
        revisionId,
        input: prepareInput(),
        requestId: "edit-failed-prepare",
      }),
    ).rejects.toMatchObject({ code: "STATE_CONFLICT" });

    const cancelled = await service.cancelPending({
      actor: { id: reviewerId, role: "reviewer" },
      mediaId,
      revisionId,
      requestId: "edit-failed-cancel",
    });
    expect(cancelled.state).toMatchObject({
      pendingRevisionId: null,
      generation: 2,
      pendingStatus: null,
    });
  });

  it("rejects stale multi-device apply state", async () => {
    const created = await service.createRevision({
      actor: { id: reviewerId, role: "reviewer" },
      mediaId,
      input: createInput(),
      requestId: "edit-conflict-create",
    });
    const revisionId = created.state.pendingRevisionId;
    if (revisionId === null) throw new Error("pending revision missing");

    await expect(
      service.apply({
        actor: { id: reviewerId, role: "reviewer" },
        mediaId,
        revisionId,
        input: { expectedGeneration: 0, expectedActiveRevisionId: null },
        requestId: "edit-conflict-apply",
      }),
    ).rejects.toMatchObject({ code: "EDIT_VERSION_CONFLICT" });
  });

  it("allows an uploader to edit only their own uploaded media", async () => {
    const [owner] = await database
      .insert(schema.users)
      .values({
        username: "edit-owner",
        normalizedUsername: "edit-owner",
        displayName: "上传者 A",
        role: "uploader",
        passwordHash: "hash",
        mustChangePassword: false,
      })
      .returning({ id: schema.users.id });
    const [other] = await database
      .insert(schema.users)
      .values({
        username: "edit-other",
        normalizedUsername: "edit-other",
        displayName: "上传者 B",
        role: "uploader",
        passwordHash: "hash",
        mustChangePassword: false,
      })
      .returning({ id: schema.users.id });
    if (owner === undefined || other === undefined) throw new Error("uploader insert failed");

    await database
      .update(schema.media)
      .set({ uploaderId: owner.id })
      .where(eq(schema.media.id, mediaId));

    const owned = await service.getContext({ id: owner.id, role: "uploader" }, mediaId);
    expect(owned.mediaId).toBe(mediaId);

    await expect(
      service.getContext({ id: other.id, role: "uploader" }, mediaId),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      service.apply({
        actor: { id: other.id, role: "uploader" },
        mediaId,
        revisionId: mediaId,
        input: { expectedGeneration: 0, expectedActiveRevisionId: null },
        requestId: "other-uploader-apply",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      service.revert({
        actor: { id: other.id, role: "uploader" },
        mediaId,
        input: {
          expectedGeneration: 0,
          expectedActiveRevisionId: null,
          targetRevisionId: null,
        },
        requestId: "other-uploader-revert",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("only signs a remote edit source after the base original is verified", async () => {
    await expect(
      service.source({ id: reviewerId, role: "reviewer" }, mediaId),
    ).rejects.toMatchObject({ code: "DOWNLOAD_NOT_READY" });

    storage.objects.set(`media/albums/${albumId}/photos/${mediaId}/original.jpg`, {
      bytes: 4_000_000,
      contentType: "image/jpeg",
      etag: "base-etag",
    });
    await database
      .update(schema.mediaVariants)
      .set({ verified: true, bytes: 4_000_000, etag: "base-etag", completedAt: new Date() })
      .where(eq(schema.mediaVariants.id, originalVariantId));

    const source = await service.source({ id: reviewerId, role: "reviewer" }, mediaId);
    expect(source.url).toContain("/original.jpg");
  });
});
