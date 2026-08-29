import { describe, expect, it } from "vitest";

import {
  type BibAttributeMappingInput,
  type BibAttributeOptionInput,
  type BibCandidateInput,
  type BibPatternInput,
  bibConfigUpdateSchema,
  deriveBibAttributes,
  evaluateBibNumber,
  normalizeBibCandidates,
  normalizeBibNumber,
  normalizeBibRanges,
  submitBibCandidatesRequestSchema,
  validateBibMappings,
  validateBibRuleSet,
} from "./bib.js";

const patterns: BibPatternInput[] = [
  {
    totalLength: 6,
    sortOrder: 0,
    enabled: true,
    constraints: [
      {
        startPosition: 1,
        width: 3,
        sortOrder: 0,
        ranges: [
          { start: "101", end: "112" },
          { start: "201", end: "212" },
        ],
      },
    ],
  },
];

describe("bib rule engine", () => {
  it("normalizes ranges and preserves fixed-width leading zeros", () => {
    expect(
      normalizeBibRanges(
        [
          { start: "001", end: "005" },
          { start: "004", end: "010" },
          { start: "011", end: "011" },
        ],
        3,
      ),
    ).toEqual([{ start: "001", end: "011" }]);
    expect(normalizeBibNumber(" １２ ３４ ")).toBe("1234");
    expect(normalizeBibNumber("O123")).toBeNull();
    expect(
      validateBibRuleSet([
        {
          totalLength: 6,
          sortOrder: 0,
          enabled: true,
          constraints: [
            {
              startPosition: 1,
              width: 3,
              sortOrder: 0,
              ranges: [
                { start: "101", end: "112" },
                { start: "20", end: "21" },
              ],
            },
          ],
        },
      ]),
    ).toMatchObject({ usable: false });
  });

  it("evaluates OR patterns and overlapping AND constraints", () => {
    expect(validateBibRuleSet(patterns)).toMatchObject({ usable: true, issues: [] });
    expect(evaluateBibNumber("101000", patterns).valid).toBe(true);
    expect(evaluateBibNumber("199000", patterns).valid).toBe(false);
    const impossible: BibPatternInput[] = [
      {
        totalLength: 2,
        sortOrder: 0,
        enabled: true,
        constraints: [
          { startPosition: 1, width: 2, sortOrder: 0, ranges: [{ start: "10", end: "19" }] },
          { startPosition: 2, width: 1, sortOrder: 1, ranges: [{ start: "5", end: "5" }] },
          { startPosition: 1, width: 1, sortOrder: 2, ranges: [{ start: "2", end: "2" }] },
        ],
      },
    ];
    expect(validateBibRuleSet(impossible)).toMatchObject({ usable: false });
    expect(
      validateBibRuleSet([
        {
          totalLength: 12,
          sortOrder: 0,
          enabled: true,
          constraints: [
            {
              startPosition: 12,
              width: 1,
              sortOrder: 0,
              ranges: [{ start: "1", end: "1" }],
            },
            {
              startPosition: 12,
              width: 1,
              sortOrder: 1,
              ranges: [{ start: "2", end: "2" }],
            },
          ],
        },
      ]),
    ).toMatchObject({ usable: false });
  });

  it("rejects conflicting attribute mappings and derives both dimensions from one number", () => {
    const gradeOne = "019d0000-0000-7000-8000-000000000001";
    const gradeTwo = "019d0000-0000-7000-8000-000000000002";
    const classOne = "019d0000-0000-7000-8000-000000000003";
    const options: BibAttributeOptionInput[] = [
      { id: gradeOne, dimension: "grade", displayName: "初一", sortOrder: 0, enabled: true },
      { id: gradeTwo, dimension: "grade", displayName: "初二", sortOrder: 1, enabled: true },
      { id: classOne, dimension: "class", displayName: "一班", sortOrder: 0, enabled: true },
    ];
    const mappings: BibAttributeMappingInput[] = [
      {
        id: "019d0000-0000-7000-8000-000000000011",
        dimension: "grade",
        startPosition: 1,
        width: 1,
        ranges: [{ start: "1", end: "1" }],
        outputOptionId: gradeOne,
        sortOrder: 0,
      },
      {
        id: "019d0000-0000-7000-8000-000000000012",
        dimension: "class",
        startPosition: 2,
        width: 2,
        ranges: [{ start: "01", end: "01" }],
        outputOptionId: classOne,
        sortOrder: 0,
      },
    ];
    expect(validateBibMappings(patterns, options, mappings)).toMatchObject({ usable: true });
    expect(deriveBibAttributes("101999", mappings)).toMatchObject({
      gradeOptionId: gradeOne,
      classOptionId: classOne,
    });
    expect(
      validateBibMappings(patterns, options, [
        ...mappings,
        {
          dimension: "grade",
          startPosition: 1,
          width: 3,
          ranges: [{ start: "101", end: "101" }],
          outputOptionId: gradeTwo,
          sortOrder: 2,
        },
      ]),
    ).toMatchObject({ usable: false });
    expect(
      validateBibMappings(patterns, options, [
        {
          dimension: "grade",
          startPosition: 7,
          width: 1,
          ranges: [{ start: "1", end: "1" }],
          outputOptionId: gradeOne,
          sortOrder: 0,
        },
      ]),
    ).toMatchObject({ usable: false });
  });

  it("filters invalid OCR text and merges overlapping duplicate boxes by confidence", () => {
    const box: NonNullable<BibCandidateInput["quadrilateral"]> = [
      { x: 0.1, y: 0.1 },
      { x: 0.3, y: 0.1 },
      { x: 0.3, y: 0.2 },
      { x: 0.1, y: 0.2 },
    ];
    const normalized = normalizeBibCandidates(
      [
        { text: "101000", confidence: 0.6, quadrilateral: box, modelVersion: "v1" },
        { text: "１０１０００", confidence: 0.9, quadrilateral: box, modelVersion: "v1" },
        { text: "O01000", confidence: 1, quadrilateral: box, modelVersion: "v1" },
      ],
      patterns,
    );
    expect(normalized).toHaveLength(1);
    expect(normalized[0]).toMatchObject({ number: "101000", confidence: 0.9 });
  });

  it("rejects duplicate config ids and candidates attached to a failed OCR activity", () => {
    const optionId = "019d0000-0000-7000-8000-000000000021";
    expect(
      bibConfigUpdateSchema.safeParse({
        recognitionEnabled: false,
        searchEnabled: false,
        modelVersion: "test",
        patterns: [],
        attributeOptions: [
          { id: optionId, dimension: "grade", displayName: "初一", sortOrder: 0, enabled: true },
          {
            id: optionId,
            dimension: "grade",
            displayName: "初一重复",
            sortOrder: 1,
            enabled: true,
          },
        ],
        mappings: [],
      }).success,
    ).toBe(false);
    expect(
      submitBibCandidatesRequestSchema.safeParse({
        activityStatus: "failed",
        modelVersion: "test",
        ruleVersion: 1,
        candidates: [
          { text: "101999", confidence: 0.9, quadrilateral: null, modelVersion: "test" },
        ],
      }).success,
    ).toBe(false);
  });
});
