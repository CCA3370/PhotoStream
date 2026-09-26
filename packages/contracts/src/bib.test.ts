import { describe, expect, it } from "vitest";

import {
  type BibAttributeOptionInput,
  type BibAttributeRuleInput,
  type BibCandidateInput,
  type BibPatternInput,
  bibConfigUpdateSchema,
  deriveBibAttributes,
  evaluateBibNumber,
  normalizeBibCandidates,
  normalizeBibNumber,
  normalizeBibRanges,
  submitBibCandidatesRequestSchema,
  validateBibAttributeRules,
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

  it("evaluates OR branches and overlapping AND conditions", () => {
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

  it("supports dependent digit ranges with separate OR branches", () => {
    const conditionalBranches: BibPatternInput[] = [
      {
        totalLength: 4,
        sortOrder: 0,
        enabled: true,
        constraints: [
          { startPosition: 1, width: 1, sortOrder: 0, ranges: [{ start: "1", end: "1" }] },
          { startPosition: 3, width: 1, sortOrder: 1, ranges: [{ start: "2", end: "5" }] },
        ],
      },
      {
        totalLength: 4,
        sortOrder: 1,
        enabled: true,
        constraints: [
          { startPosition: 1, width: 1, sortOrder: 0, ranges: [{ start: "2", end: "2" }] },
          { startPosition: 3, width: 1, sortOrder: 1, ranges: [{ start: "6", end: "9" }] },
        ],
      },
    ];

    expect(validateBibRuleSet(conditionalBranches)).toMatchObject({ usable: true, issues: [] });
    expect(evaluateBibNumber("1020", conditionalBranches).valid).toBe(true);
    expect(evaluateBibNumber("1060", conditionalBranches).valid).toBe(false);
    expect(evaluateBibNumber("2060", conditionalBranches).valid).toBe(true);
    expect(evaluateBibNumber("2020", conditionalBranches).valid).toBe(false);
    expect(evaluateBibNumber("3060", conditionalBranches).valid).toBe(false);
  });

  it("rejects enabled branches without any conditions", () => {
    expect(
      validateBibRuleSet([
        {
          totalLength: 6,
          sortOrder: 0,
          enabled: true,
          constraints: [],
        },
      ]),
    ).toMatchObject({
      usable: false,
      issues: [expect.objectContaining({ code: "EMPTY_PATTERN" })],
    });
  });

  it("ignores disabled branches when determining rule usability", () => {
    expect(
      validateBibRuleSet([
        {
          totalLength: 4,
          sortOrder: 0,
          enabled: true,
          constraints: [
            { startPosition: 1, width: 1, sortOrder: 0, ranges: [{ start: "1", end: "1" }] },
          ],
        },
        {
          totalLength: 2,
          sortOrder: 1,
          enabled: false,
          constraints: [
            { startPosition: 2, width: 2, sortOrder: 0, ranges: [{ start: "00", end: "99" }] },
          ],
        },
      ]),
    ).toMatchObject({ usable: true, issues: [] });
  });

  it("derives ordered grade and class attributes without per-value mappings", () => {
    const gradeOne = "019d0000-0000-7000-8000-000000000001";
    const gradeTwo = "019d0000-0000-7000-8000-000000000002";
    const gradeOneClassOne = "019d0000-0000-7000-8000-000000000003";
    const gradeTwoClassOne = "019d0000-0000-7000-8000-000000000004";
    const gradeOneClassTwo = "019d0000-0000-7000-8000-000000000005";
    const options: BibAttributeOptionInput[] = [
      { id: gradeOne, dimension: "grade", displayName: "初一", sortOrder: 0, ordinal: 0, enabled: true },
      { id: gradeTwo, dimension: "grade", displayName: "初二", sortOrder: 1, ordinal: 1, enabled: true },
      { id: gradeOneClassOne, dimension: "class", displayName: "1班", sortOrder: 0, ordinal: 0, enabled: true, parentGradeOptionId: gradeOne },
      { id: gradeTwoClassOne, dimension: "class", displayName: "1班", sortOrder: 0, ordinal: 0, enabled: true, parentGradeOptionId: gradeTwo },
      { id: gradeOneClassTwo, dimension: "class", displayName: "2班", sortOrder: 1, ordinal: 1, enabled: true, parentGradeOptionId: gradeOne },
    ];
    const rules: BibAttributeRuleInput[] = [
      { dimension: "grade", startPosition: 1, width: 1, firstValue: 1 },
      { dimension: "class", startPosition: 2, width: 2, firstValue: 1 },
    ];
    expect(validateBibAttributeRules(patterns, options, rules)).toMatchObject({ usable: true, issues: [] });
    expect(deriveBibAttributes("101999", rules, options)).toEqual({
      gradeOptionId: gradeOne,
      classOptionId: gradeOneClassOne,
    });
    expect(deriveBibAttributes("102999", rules, options)).toEqual({
      gradeOptionId: gradeOne,
      classOptionId: gradeOneClassTwo,
    });
    expect(deriveBibAttributes("103999", rules, options)).toEqual({
      gradeOptionId: gradeOne,
      classOptionId: null,
    });
    expect(deriveBibAttributes("201999", rules, options)).toEqual({
      gradeOptionId: gradeTwo,
      classOptionId: gradeTwoClassOne,
    });
    expect(
      deriveBibAttributes(
        "101999",
        rules,
        options.map((option) =>
          option.id === gradeOne
            ? { ...option, sortOrder: 99 }
            : option.id === gradeTwo
              ? { ...option, sortOrder: 0 }
              : option,
        ),
      ),
    ).toEqual({
      gradeOptionId: gradeOne,
      classOptionId: gradeOneClassOne,
    });
    expect(
      deriveBibAttributes(
        "201999",
        rules,
        options.map((option) => (option.id === gradeOne ? { ...option, enabled: false } : option)),
      ),
    ).toEqual({
      gradeOptionId: gradeTwo,
      classOptionId: gradeTwoClassOne,
    });
  });

  it("validates compact attribute rules", () => {
    const gradeOne = "019d0000-0000-7000-8000-000000000101";
    const classOne = "019d0000-0000-7000-8000-000000000102";
    const options: BibAttributeOptionInput[] = [
      { id: gradeOne, dimension: "grade", displayName: "初一", sortOrder: 0, ordinal: 0, enabled: true },
      { id: classOne, dimension: "class", displayName: "1班", sortOrder: 0, ordinal: 0, enabled: true, parentGradeOptionId: gradeOne },
    ];
    expect(validateBibAttributeRules(patterns, options, [
      { dimension: "class", startPosition: 2, width: 2, firstValue: 1 },
    ])).toMatchObject({ usable: false });
    expect(validateBibAttributeRules(patterns, options, [
      { dimension: "grade", startPosition: 7, width: 1, firstValue: 1 },
    ])).toMatchObject({ usable: false });
    expect(validateBibAttributeRules(patterns, options, [
      { dimension: "grade", startPosition: 1, width: 1, firstValue: 1 },
      { dimension: "grade", startPosition: 1, width: 1, firstValue: 1 },
    ])).toMatchObject({ usable: false });
    expect(
      validateBibAttributeRules(
        patterns,
        [
          ...options,
          {
            id: "019d0000-0000-7000-8000-000000000103",
            dimension: "grade",
            displayName: "重复编码槽位",
            sortOrder: 5,
            ordinal: 0,
            enabled: true,
          },
        ],
        [{ dimension: "grade", startPosition: 1, width: 1, firstValue: 1 }],
      ),
    ).toMatchObject({ usable: false });
    const firstOption = options[0];
    if (firstOption === undefined) throw new Error("Expected grade option fixture");
    expect(
      validateBibAttributeRules(
        patterns,
        [{ ...firstOption, ordinal: 9 }],
        [{ dimension: "grade", startPosition: 1, width: 1, firstValue: 1 }],
      ),
    ).toMatchObject({
      usable: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "ATTRIBUTE_ORDINAL_OUT_OF_RANGE" }),
      ]),
    });
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
          { id: optionId, dimension: "grade", displayName: "初一", sortOrder: 0, ordinal: 0, enabled: true },
          {
            id: optionId,
            dimension: "grade",
            displayName: "初一重复",
            sortOrder: 1,
            ordinal: 1,
            enabled: true,
          },
        ],
        attributeRules: [],
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
