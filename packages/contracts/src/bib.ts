import { z } from "zod";

const digitStringSchema = z.string().regex(/^\d{1,12}$/u, "必须是 1–12 位数字字符串");

export const bibRangeSchema = z
  .object({ id: z.string().uuid().optional(), start: digitStringSchema, end: digitStringSchema })
  .strict()
  .superRefine((value, context) => {
    if (value.start.length !== value.end.length) {
      context.addIssue({ code: "custom", message: "区间端点宽度必须相同", path: ["end"] });
    } else if (value.start > value.end) {
      context.addIssue({ code: "custom", message: "区间起点不能大于终点", path: ["end"] });
    }
  });
export type BibRange = z.infer<typeof bibRangeSchema>;

export const bibConstraintInputSchema = z
  .object({
    id: z.string().uuid().optional(),
    startPosition: z.number().int().min(1).max(12),
    width: z.number().int().min(1).max(12),
    ranges: z.array(bibRangeSchema).min(1).max(50),
    sortOrder: z.number().int().min(0).max(10_000).default(0),
  })
  .strict();
export type BibConstraintInput = z.infer<typeof bibConstraintInputSchema>;

export const bibPatternInputSchema = z
  .object({
    id: z.string().uuid().optional(),
    totalLength: z.number().int().min(1).max(12),
    sortOrder: z.number().int().min(0).max(10_000).default(0),
    enabled: z.boolean().default(true),
    constraints: z.array(bibConstraintInputSchema).max(30).default([]),
  })
  .strict();
export type BibPatternInput = z.infer<typeof bibPatternInputSchema>;

export const bibAttributeDimensionSchema = z.enum(["grade", "class"]);
export type BibAttributeDimension = z.infer<typeof bibAttributeDimensionSchema>;

export const bibAttributeOptionInputSchema = z
  .object({
    id: z.string().uuid(),
    dimension: bibAttributeDimensionSchema,
    displayName: z.string().trim().min(1).max(60),
    sortOrder: z.number().int().min(0).max(10_000).default(0),
    enabled: z.boolean().default(true),
  })
  .strict();
export type BibAttributeOptionInput = z.infer<typeof bibAttributeOptionInputSchema>;

export const bibAttributeMappingInputSchema = z
  .object({
    id: z.string().uuid().optional(),
    dimension: bibAttributeDimensionSchema,
    startPosition: z.number().int().min(1).max(12),
    width: z.number().int().min(1).max(12),
    ranges: z.array(bibRangeSchema).min(1).max(50),
    outputOptionId: z.string().uuid(),
    sortOrder: z.number().int().min(0).max(10_000).default(0),
  })
  .strict();
export type BibAttributeMappingInput = z.infer<typeof bibAttributeMappingInputSchema>;

export const bibConfigUpdateSchema = z
  .object({
    recognitionEnabled: z.boolean(),
    searchEnabled: z.boolean(),
    modelVersion: z.string().trim().min(1).max(80),
    patterns: z.array(bibPatternInputSchema).max(20),
    attributeOptions: z.array(bibAttributeOptionInputSchema).max(100),
    mappings: z.array(bibAttributeMappingInputSchema).max(100),
  })
  .strict()
  .superRefine((value, context) => {
    const groups: ReadonlyArray<{
      readonly ids: readonly (string | undefined)[];
      readonly path: string;
    }> = [
      { ids: value.patterns.map((pattern) => pattern.id), path: "patterns" },
      {
        ids: value.patterns.flatMap((pattern) =>
          pattern.constraints.map((constraint) => constraint.id),
        ),
        path: "patterns.constraints",
      },
      {
        ids: value.patterns.flatMap((pattern) =>
          pattern.constraints.flatMap((constraint) => constraint.ranges.map((range) => range.id)),
        ),
        path: "patterns.constraints.ranges",
      },
      { ids: value.attributeOptions.map((option) => option.id), path: "attributeOptions" },
      { ids: value.mappings.map((mapping) => mapping.id), path: "mappings" },
      {
        ids: value.mappings.flatMap((mapping) => mapping.ranges.map((range) => range.id)),
        path: "mappings.ranges",
      },
    ];
    for (const group of groups) {
      const present = group.ids.filter((id): id is string => id !== undefined);
      if (new Set(present).size !== present.length) {
        context.addIssue({ code: "custom", message: "配置实体 ID 不能重复", path: [group.path] });
      }
    }
  });
export type BibConfigUpdate = z.infer<typeof bibConfigUpdateSchema>;

export const bibValidationIssueSchema = z
  .object({ code: z.string(), path: z.string(), message: z.string() })
  .strict();
export type BibValidationIssue = z.infer<typeof bibValidationIssueSchema>;

export const bibConfigViewSchema = bibConfigUpdateSchema
  .extend({
    albumId: z.string().uuid(),
    automationStatus: z.enum(["disabled", "experimental", "qualified"]),
    ruleVersion: z.number().int().min(0),
    mappingVersion: z.number().int().min(0),
    ruleUsable: z.boolean(),
    mappingUsable: z.boolean(),
    recalculationStatus: z.enum(["idle", "pending", "processing", "failed"]).default("idle"),
    issues: z.array(bibValidationIssueSchema),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type BibConfigView = z.infer<typeof bibConfigViewSchema>;

export const bibTestRequestSchema = z.object({ number: digitStringSchema }).strict();

export const bibConstraintTestResultSchema = z
  .object({
    constraintIndex: z.number().int().min(0),
    startPosition: z.number().int().min(1),
    width: z.number().int().min(1),
    value: z.string(),
    matched: z.boolean(),
  })
  .strict();

export const bibTestResponseSchema = z
  .object({
    normalizedNumber: digitStringSchema,
    valid: z.boolean(),
    matchedPatternIndexes: z.array(z.number().int().min(0)),
    patterns: z.array(
      z
        .object({
          patternIndex: z.number().int().min(0),
          lengthMatched: z.boolean(),
          matched: z.boolean(),
          constraints: z.array(bibConstraintTestResultSchema),
        })
        .strict(),
    ),
    gradeOptionId: z.string().uuid().nullable(),
    classOptionId: z.string().uuid().nullable(),
    matchedMappingIds: z.array(z.string().uuid()),
  })
  .strict();
export type BibTestResponse = z.infer<typeof bibTestResponseSchema>;

export const bibPointSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});
export const bibQuadrilateralSchema = z
  .tuple([bibPointSchema, bibPointSchema, bibPointSchema, bibPointSchema])
  .nullable();

export const bibCandidateInputSchema = z
  .object({
    text: z.string().min(1).max(80),
    confidence: z.number().min(0).max(1),
    quadrilateral: bibQuadrilateralSchema,
    modelVersion: z.string().trim().min(1).max(80),
  })
  .strict();
export type BibCandidateInput = z.infer<typeof bibCandidateInputSchema>;

export const submitBibCandidatesRequestSchema = z
  .object({
    activityStatus: z.enum(["processing", "completed", "failed", "unsupported"]),
    modelVersion: z.string().trim().min(1).max(80),
    ruleVersion: z.number().int().min(0),
    candidates: z.array(bibCandidateInputSchema).max(8),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.activityStatus !== "completed" && value.candidates.length > 0) {
      context.addIssue({
        code: "custom",
        message: "只有已完成的 OCR 活动可以携带候选",
        path: ["candidates"],
      });
    }
    value.candidates.forEach((candidate, index) => {
      if (candidate.modelVersion !== value.modelVersion) {
        context.addIssue({
          code: "custom",
          message: "候选模型版本必须与本次 OCR 活动一致",
          path: ["candidates", index, "modelVersion"],
        });
      }
    });
  });

export const addBibTagRequestSchema = z.object({ number: digitStringSchema }).strict();
export const confirmBibTagRequestSchema = z
  .object({ number: digitStringSchema.optional() })
  .strict();

export const bibTagStatusSchema = z.enum(["suggested", "confirmed", "rejected", "needs_review"]);
export const bibTagSourceSchema = z.enum(["ocr", "manual"]);
export const bibReviewDecisionSchema = z.enum([
  "pending",
  "numbers_confirmed",
  "no_number_confirmed",
  "needs_review",
]);
export const bibOcrStatusSchema = z.enum([
  "not_started",
  "processing",
  "completed",
  "failed",
  "unsupported",
]);

export const bibTagViewSchema = z
  .object({
    id: z.string().uuid(),
    mediaId: z.string().uuid(),
    number: digitStringSchema,
    status: bibTagStatusSchema,
    source: bibTagSourceSchema,
    confidence: z.number().min(0).max(1).nullable(),
    quadrilateral: bibQuadrilateralSchema,
    ruleVersion: z.number().int().min(0),
    modelVersion: z.string().nullable(),
    gradeOptionId: z.string().uuid().nullable(),
    classOptionId: z.string().uuid().nullable(),
    mappingVersion: z.number().int().min(0),
    createdAt: z.string().datetime(),
    confirmedAt: z.string().datetime().nullable(),
  })
  .strict();
export type BibTagView = z.infer<typeof bibTagViewSchema>;

export const bibReviewViewSchema = z
  .object({
    mediaId: z.string().uuid(),
    decision: bibReviewDecisionSchema,
    ocrStatus: bibOcrStatusSchema,
    ocrModelVersion: z.string().nullable(),
    decidedAt: z.string().datetime().nullable(),
  })
  .strict();
export type BibReviewView = z.infer<typeof bibReviewViewSchema>;

export const bibMediaStateSchema = z
  .object({ tags: z.array(bibTagViewSchema), review: bibReviewViewSchema })
  .strict();
export type BibMediaState = z.infer<typeof bibMediaStateSchema>;

export const bibBatchTagRequestSchema = z
  .object({
    mediaIds: z.array(z.string().uuid()).min(1).max(200),
    number: digitStringSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.mediaIds).size !== value.mediaIds.length) {
      context.addIssue({ code: "custom", message: "媒体 ID 不能重复", path: ["mediaIds"] });
    }
  });

export const bibBatchNoNumberRequestSchema = z
  .object({ mediaIds: z.array(z.string().uuid()).min(1).max(200) })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.mediaIds).size !== value.mediaIds.length) {
      context.addIssue({ code: "custom", message: "媒体 ID 不能重复", path: ["mediaIds"] });
    }
  });

export const bibBatchResultSchema = z
  .object({
    items: z.array(
      z
        .object({
          mediaId: z.string().uuid(),
          ok: z.boolean(),
          code: z.string().nullable(),
          message: z.string().nullable(),
        })
        .strict(),
    ),
  })
  .strict();
export type BibBatchResult = z.infer<typeof bibBatchResultSchema>;

export const publicBibSearchRequestSchema = z
  .object({ number: digitStringSchema, cursor: z.string().max(1_000).optional() })
  .strict();

export const publicBibAttributeFilterRequestSchema = z
  .object({
    gradeOptionId: z.string().uuid(),
    classOptionId: z.string().uuid().optional(),
    categoryId: z.string().uuid().optional(),
    cursor: z.string().max(1_000).optional(),
  })
  .strict();

interface CompiledConstraint {
  readonly startPosition: number;
  readonly width: number;
  readonly ranges: readonly BibRange[];
}

export function normalizeBibNumber(value: string): string | null {
  const normalized = [...value.normalize("NFKC")]
    .map((character) => {
      const code = character.charCodeAt(0);
      return code >= 0xff10 && code <= 0xff19 ? String(code - 0xff10) : character;
    })
    .join("")
    .replace(/\s+/gu, "");
  return /^\d{1,12}$/u.test(normalized) ? normalized : null;
}

function bibRangeValidForWidth(range: BibRange, width: number): boolean {
  return (
    range.start.length === width &&
    range.end.length === width &&
    /^\d+$/u.test(range.start) &&
    /^\d+$/u.test(range.end) &&
    range.start <= range.end
  );
}

export function normalizeBibRanges(ranges: readonly BibRange[], width: number): BibRange[] {
  const valid = ranges
    .filter((range) => bibRangeValidForWidth(range, width))
    .toSorted(
      (left, right) => left.start.localeCompare(right.start) || left.end.localeCompare(right.end),
    );
  const merged: BibRange[] = [];
  for (const range of valid) {
    const previous = merged.at(-1);
    if (previous === undefined) {
      merged.push({ ...range });
      continue;
    }
    const adjacent = Number(range.start) <= Number(previous.end) + 1;
    if (range.start <= previous.end || adjacent) {
      previous.end = previous.end > range.end ? previous.end : range.end;
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

function constraintMatches(number: string, constraint: CompiledConstraint): boolean {
  const value = number.slice(
    constraint.startPosition - 1,
    constraint.startPosition - 1 + constraint.width,
  );
  return (
    value.length === constraint.width &&
    constraint.ranges.some((range) => value >= range.start && value <= range.end)
  );
}

function constraintCanMatchAssignments(
  assignments: readonly (number | null)[],
  constraint: CompiledConstraint,
): boolean {
  const start = constraint.startPosition - 1;
  const assigned = assignments.slice(start, start + constraint.width);
  const minimum = assigned.map((value) => value ?? 0).join("");
  const maximum = assigned.map((value) => value ?? 9).join("");
  return constraint.ranges.some((range) => minimum <= range.end && maximum >= range.start);
}

function hasSatisfyingNumber(
  totalLength: number,
  constraints: readonly CompiledConstraint[],
): boolean {
  const assignments = Array.from<number | null>({ length: totalLength }).fill(null);
  const constrainedPositions = [
    ...new Set(
      constraints.flatMap((constraint) =>
        Array.from(
          { length: constraint.width },
          (_, index) => constraint.startPosition - 1 + index,
        ),
      ),
    ),
  ].toSorted((left, right) => {
    const frequency = (position: number) =>
      constraints.filter(
        (constraint) =>
          position >= constraint.startPosition - 1 &&
          position < constraint.startPosition - 1 + constraint.width,
      ).length;
    return frequency(right) - frequency(left) || left - right;
  });
  const search = (positionIndex: number): boolean => {
    if (constraints.some((constraint) => !constraintCanMatchAssignments(assignments, constraint))) {
      return false;
    }
    if (positionIndex === constrainedPositions.length) return true;
    const position = constrainedPositions[positionIndex];
    if (position === undefined) return true;
    for (let digit = 0; digit <= 9; digit += 1) {
      assignments[position] = digit;
      if (search(positionIndex + 1)) return true;
    }
    assignments[position] = null;
    return false;
  };
  return search(0);
}

function compiledConstraint(input: BibConstraintInput): CompiledConstraint {
  return {
    startPosition: input.startPosition,
    width: input.width,
    ranges: normalizeBibRanges(input.ranges, input.width),
  };
}

export function validateBibRuleSet(patterns: readonly BibPatternInput[]): {
  readonly usable: boolean;
  readonly issues: readonly BibValidationIssue[];
} {
  const issues: BibValidationIssue[] = [];
  const enabled = patterns.filter((pattern) => pattern.enabled);
  if (enabled.length === 0) {
    issues.push({ code: "NO_ENABLED_PATTERN", path: "patterns", message: "至少启用一条号码模式" });
  }
  patterns.forEach((pattern, patternIndex) => {
    const constraints = pattern.constraints.map((constraint, constraintIndex) => {
      if (constraint.startPosition + constraint.width - 1 > pattern.totalLength) {
        issues.push({
          code: "CONSTRAINT_OUT_OF_BOUNDS",
          path: `patterns.${patternIndex}.constraints.${constraintIndex}`,
          message: "约束位置超出模式总位数",
        });
      }
      const normalized = normalizeBibRanges(constraint.ranges, constraint.width);
      if (constraint.ranges.some((range) => !bibRangeValidForWidth(range, constraint.width))) {
        issues.push({
          code: "INVALID_RANGE_WIDTH",
          path: `patterns.${patternIndex}.constraints.${constraintIndex}.ranges`,
          message: "区间必须与约束宽度一致且起点不大于终点",
        });
      }
      if (normalized.length === 0) {
        issues.push({
          code: "EMPTY_CONSTRAINT",
          path: `patterns.${patternIndex}.constraints.${constraintIndex}.ranges`,
          message: "约束没有有效区间",
        });
      }
      return {
        startPosition: constraint.startPosition,
        width: constraint.width,
        ranges: normalized,
      };
    });
    if (
      pattern.enabled &&
      !issues.some((issue) => issue.path.startsWith(`patterns.${patternIndex}.`)) &&
      !hasSatisfyingNumber(pattern.totalLength, constraints)
    ) {
      issues.push({
        code: "UNSATISFIABLE_PATTERN",
        path: `patterns.${patternIndex}`,
        message: "约束互相冲突，没有号码可以通过",
      });
    }
  });
  return { usable: enabled.length > 0 && issues.length === 0, issues };
}

export function evaluateBibNumber(
  number: string,
  patterns: readonly BibPatternInput[],
): Pick<BibTestResponse, "matchedPatternIndexes" | "patterns" | "valid"> {
  const results = patterns.map((pattern, patternIndex) => {
    const lengthMatched = number.length === pattern.totalLength;
    const constraints = pattern.constraints.map((constraint, constraintIndex) => {
      const value = number.slice(
        constraint.startPosition - 1,
        constraint.startPosition - 1 + constraint.width,
      );
      return {
        constraintIndex,
        startPosition: constraint.startPosition,
        width: constraint.width,
        value,
        matched: lengthMatched && constraintMatches(number, compiledConstraint(constraint)),
      };
    });
    const matched = pattern.enabled && lengthMatched && constraints.every((item) => item.matched);
    return { patternIndex, lengthMatched, matched, constraints };
  });
  const matchedPatternIndexes = results
    .filter((result) => result.matched)
    .map((result) => result.patternIndex);
  return { valid: matchedPatternIndexes.length > 0, matchedPatternIndexes, patterns: results };
}

function mappingConstraint(mapping: BibAttributeMappingInput): CompiledConstraint {
  return {
    startPosition: mapping.startPosition,
    width: mapping.width,
    ranges: normalizeBibRanges(mapping.ranges, mapping.width),
  };
}

export function validateBibMappings(
  patterns: readonly BibPatternInput[],
  options: readonly BibAttributeOptionInput[],
  mappings: readonly BibAttributeMappingInput[],
): { readonly usable: boolean; readonly issues: readonly BibValidationIssue[] } {
  const issues: BibValidationIssue[] = [];
  const optionById = new Map(options.map((option) => [option.id, option]));
  if (optionById.size !== options.length) {
    issues.push({
      code: "DUPLICATE_ATTRIBUTE_OPTION",
      path: "attributeOptions",
      message: "属性选项 ID 不能重复",
    });
  }
  mappings.forEach((mapping, mappingIndex) => {
    const option = optionById.get(mapping.outputOptionId);
    if (option === undefined || option.dimension !== mapping.dimension || !option.enabled) {
      issues.push({
        code: "INVALID_MAPPING_OPTION",
        path: `mappings.${mappingIndex}.outputOptionId`,
        message: "映射输出选项不存在、维度不符或已停用",
      });
    }
    const normalizedRanges = normalizeBibRanges(mapping.ranges, mapping.width);
    if (mapping.ranges.some((range) => !bibRangeValidForWidth(range, mapping.width))) {
      issues.push({
        code: "INVALID_MAPPING_RANGE_WIDTH",
        path: `mappings.${mappingIndex}.ranges`,
        message: "映射区间必须与映射宽度一致且起点不大于终点",
      });
    }
    if (normalizedRanges.length === 0) {
      issues.push({
        code: "EMPTY_MAPPING",
        path: `mappings.${mappingIndex}.ranges`,
        message: "映射没有有效区间",
      });
    }
    if (
      !patterns.some(
        (pattern) =>
          pattern.enabled && mapping.startPosition + mapping.width - 1 <= pattern.totalLength,
      )
    ) {
      issues.push({
        code: "MAPPING_OUT_OF_BOUNDS",
        path: `mappings.${mappingIndex}`,
        message: "映射位置未落入任何已启用号码模式",
      });
    }
  });
  for (let leftIndex = 0; leftIndex < mappings.length; leftIndex += 1) {
    const left = mappings[leftIndex];
    if (left === undefined) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < mappings.length; rightIndex += 1) {
      const right = mappings[rightIndex];
      if (
        right === undefined ||
        left.dimension !== right.dimension ||
        left.outputOptionId === right.outputOptionId
      ) {
        continue;
      }
      const conflicts = patterns.some((pattern) => {
        if (!pattern.enabled) return false;
        if (
          left.startPosition + left.width - 1 > pattern.totalLength ||
          right.startPosition + right.width - 1 > pattern.totalLength
        ) {
          return false;
        }
        return hasSatisfyingNumber(pattern.totalLength, [
          ...pattern.constraints.map(compiledConstraint),
          mappingConstraint(left),
          mappingConstraint(right),
        ]);
      });
      if (conflicts) {
        issues.push({
          code: "MAPPING_CONFLICT",
          path: `mappings.${leftIndex},mappings.${rightIndex}`,
          message: "同一合法号码会映射到同一维度的不同选项",
        });
      }
    }
  }
  return { usable: issues.length === 0, issues };
}

export function deriveBibAttributes(
  number: string,
  mappings: readonly BibAttributeMappingInput[],
): {
  readonly gradeOptionId: string | null;
  readonly classOptionId: string | null;
  readonly matchedMappingIds: readonly string[];
} {
  const matching = mappings.filter((mapping) =>
    constraintMatches(number, mappingConstraint(mapping)),
  );
  const grade = matching.find((mapping) => mapping.dimension === "grade")?.outputOptionId ?? null;
  const classOption =
    matching.find((mapping) => mapping.dimension === "class")?.outputOptionId ?? null;
  return {
    gradeOptionId: grade,
    classOptionId: classOption,
    matchedMappingIds: matching.flatMap((mapping) =>
      mapping.id === undefined ? [] : [mapping.id],
    ),
  };
}

function boundingBox(quadrilateral: NonNullable<BibCandidateInput["quadrilateral"]>) {
  const xs = quadrilateral.map((point) => point.x);
  const ys = quadrilateral.map((point) => point.y);
  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys),
  };
}

function overlapRatio(
  left: NonNullable<BibCandidateInput["quadrilateral"]>,
  right: NonNullable<BibCandidateInput["quadrilateral"]>,
): number {
  const a = boundingBox(left);
  const b = boundingBox(right);
  const intersection =
    Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
    Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  const areaA = Math.max(0, a.right - a.left) * Math.max(0, a.bottom - a.top);
  const areaB = Math.max(0, b.right - b.left) * Math.max(0, b.bottom - b.top);
  const union = areaA + areaB - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function normalizeBibCandidates(
  candidates: readonly BibCandidateInput[],
  patterns: readonly BibPatternInput[],
): Array<BibCandidateInput & { readonly number: string }> {
  const accepted: Array<BibCandidateInput & { readonly number: string }> = [];
  for (const candidate of candidates) {
    const number = normalizeBibNumber(candidate.text);
    if (number === null || !evaluateBibNumber(number, patterns).valid) continue;
    const duplicateIndex = accepted.findIndex(
      (current) =>
        current.number === number &&
        current.quadrilateral !== null &&
        candidate.quadrilateral !== null &&
        overlapRatio(current.quadrilateral, candidate.quadrilateral) >= 0.5,
    );
    const normalized = { ...candidate, text: number, number };
    if (duplicateIndex < 0) accepted.push(normalized);
    else if ((accepted[duplicateIndex]?.confidence ?? 0) < candidate.confidence) {
      accepted[duplicateIndex] = normalized;
    }
  }
  return accepted.toSorted((left, right) => right.confidence - left.confidence).slice(0, 8);
}
