import type { BibConfigView, BibMediaState } from "@photostream/contracts";
import { describe, expect, it } from "vitest";

import { shouldResumeLocalBibOcr } from "./local-bib-ocr";
import {
  effectiveBibMediaState,
  type LocalReviewPhoto,
  localBibMediaState,
  localBibOcrPending,
} from "./local-review-queue";

function photo(bib: Partial<LocalReviewPhoto["bib"]>): LocalReviewPhoto {
  return {
    id: "019d0000-0000-7000-8000-000000000001",
    albumId: "019d0000-0000-7000-8000-000000000002",
    fileName: "test.jpg",
    categoryId: null,
    originalBlob: new Blob([], { type: "image/jpeg" }),
    originalFormat: "jpeg",
    originalContentType: "image/jpeg",
    width: 1920,
    height: 1080,
    totalBytes: 0,
    capturedAt: null,
    variants: [],
    featured: false,
    createdAt: "2026-09-06T00:00:00.000Z",
    intentId: null,
    mediaId: null,
    uploadState: "local",
    error: null,
    bib: {
      ocrStatus: "processing",
      modelVersion: "test-model",
      ruleVersion: 3,
      candidates: [
        {
          text: "101999",
          confidence: 0.95,
          quadrilateral: null,
          modelVersion: "test-model",
        },
      ],
      ocrError: null,
      ocrRevision: 1,
      ocrSyncedRevision: 0,
      decision: "pending",
      confirmedNumbers: [],
      decidedAt: null,
      manualRevision: 0,
      manualSyncedRevision: 0,
      ...bib,
    },
  };
}

function config(recognitionEnabled: boolean, ruleVersion = 3): BibConfigView {
  return {
    albumId: "019d0000-0000-7000-8000-000000000002",
    recognitionEnabled,
    searchEnabled: true,
    modelVersion: "test-model",
    patterns: [],
    attributeOptions: [],
    mappings: [],
    automationStatus: "experimental",
    ruleVersion,
    mappingVersion: 0,
    ruleUsable: true,
    mappingUsable: true,
    recalculationStatus: "idle",
    issues: [],
    updatedAt: "2026-09-06T00:00:00.000Z",
  };
}

function remote(decision: BibMediaState["review"]["decision"]): BibMediaState {
  return {
    tags: [],
    review: {
      mediaId: "019d0000-0000-7000-8000-000000000003",
      decision,
      ocrStatus: "completed",
      ocrModelVersion: "test-model",
      decidedAt: decision === "pending" ? null : "2026-09-06T00:01:00.000Z",
    },
  };
}

describe("local bib review state", () => {
  it("keeps manually confirmed numbers authoritative while OCR is still processing", () => {
    const state = localBibMediaState(
      photo({
        decision: "numbers_confirmed",
        confirmedNumbers: ["102888"],
        decidedAt: "2026-09-06T00:00:30.000Z",
        manualRevision: 1,
      }),
    );

    expect(state.review).toMatchObject({
      decision: "numbers_confirmed",
      ocrStatus: "processing",
    });
    expect(state.tags).toHaveLength(1);
    expect(state.tags[0]).toMatchObject({
      number: "102888",
      status: "confirmed",
      source: "manual",
    });
  });

  it("keeps confirmed no-number authoritative over late OCR candidates", () => {
    const state = localBibMediaState(
      photo({
        ocrStatus: "completed",
        decision: "no_number_confirmed",
        decidedAt: "2026-09-06T00:00:30.000Z",
        manualRevision: 1,
      }),
    );

    expect(state.review.decision).toBe("no_number_confirmed");
    expect(state.tags).toEqual([]);
  });

  it("prefers unsynced local manual state but never replaces an already confirmed server decision", () => {
    const local = photo({
      decision: "numbers_confirmed",
      confirmedNumbers: ["102888"],
      manualRevision: 2,
      manualSyncedRevision: 1,
      ocrRevision: 1,
      ocrSyncedRevision: 1,
    });

    expect(effectiveBibMediaState(local, remote("pending")).review.decision).toBe(
      "numbers_confirmed",
    );
    expect(effectiveBibMediaState(local, remote("no_number_confirmed")).review.decision).toBe(
      "no_number_confirmed",
    );
  });

  it("projects queued local OCR as processing and leaves disabled OCR idle", () => {
    expect(localBibMediaState(photo({ ocrStatus: "not_started" })).review.ocrStatus).toBe(
      "processing",
    );
    expect(localBibMediaState(photo({ ocrStatus: "disabled" })).review.ocrStatus).toBe(
      "not_started",
    );
  });

  it("only blocks list confirmation while OCR is queued or processing", () => {
    expect(localBibOcrPending(photo({ ocrStatus: "not_started" }))).toBe(true);
    expect(localBibOcrPending(photo({ ocrStatus: "processing" }))).toBe(true);
    expect(localBibOcrPending(photo({ ocrStatus: "completed" }))).toBe(false);
    expect(localBibOcrPending(photo({ ocrStatus: "failed" }))).toBe(false);
    expect(localBibOcrPending(photo({ ocrStatus: "unsupported" }))).toBe(false);
    expect(localBibOcrPending(photo({ ocrStatus: "disabled" }))).toBe(false);
  });

  it("reconciles OCR when recognition is toggled or the rule version changes", () => {
    expect(shouldResumeLocalBibOcr(photo({ ocrStatus: "not_started" }), config(true))).toBe(true);
    expect(shouldResumeLocalBibOcr(photo({ ocrStatus: "disabled" }), config(true))).toBe(true);
    expect(
      shouldResumeLocalBibOcr(
        photo({ ocrStatus: "completed", modelVersion: "test-model", ruleVersion: 3 }),
        config(true),
      ),
    ).toBe(false);
    expect(
      shouldResumeLocalBibOcr(
        photo({ ocrStatus: "completed", modelVersion: "test-model", ruleVersion: 2 }),
        config(true),
      ),
    ).toBe(true);
    expect(shouldResumeLocalBibOcr(photo({ ocrStatus: "processing" }), config(false))).toBe(true);
    expect(shouldResumeLocalBibOcr(photo({ ocrStatus: "disabled" }), config(false))).toBe(false);
  });
});
