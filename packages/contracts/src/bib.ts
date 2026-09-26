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
    ordinal: z.number().int().min(0).max(10_000),
    enabled: z.boolean().default(true),
    parentGradeOptionId: z.string().uuid().nullable().optional(),
  })
  .strict();
export type BibAttributeOptionInput = z.infer<typeof bibAttributeOptionInputSchema>;

export const bibAttributeRuleInputSchema = z
  .object({
    dimension: bibAttributeDimensionSchema,
    startPosition: z.number().int().min(1).max(12),
    width: z.number().int().min(1).max(12),
    firstValue: z.number().int().min(0).max(999_999_999_999).default(1),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.firstValue > 10 ** value.width - 1) {
      context.addIssue({
        code: "custom",
        message: "起始序号超出当前读取位数可表示的范围",
        path: ["firstValue"],
      });
    }
  });
export type BibAttributeRuleInput = z.infer<typeof bibAttributeRuleInputSchema>;

export const bibConfigUpdateSchema = z
  .object({
    recognitionEnabled: z.boolean(),
    searchEnabled: z.boolean(),
    modelVersion: z.string().trim().min(1).max(80),
    patterns: z.array(bibPatternInputSchema).max(20),
    attributeOptions: z.array(bibAttributeOptionInputSchema).max(100),
    attributeRules: z.array(bibAttributeRuleInputSchema).max(2),
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
    ];
    for (const group of groups) {
      const present = group.ids.filter((id): id is string => id !== undefined);
      if (new Set(present).size !== present.length) {
        context.addIssue({ code: "custom", message: "配置实体 ID 不能重复", path: [group.path] });
      }
    }

    if (new Set(value.attributeRules.map((rule) => rule.dimension)).size !== value.attributeRules.length) {
      context.addIssue({
        code: "custom",
        message: "同一属性只能配置一条解析规则",
        path: ["attributeRules"],
      });
    }

    const optionById = new Map(value.attributeOptions.map((option) => [option.id, option]));
    value.attributeOptions.forEach((option, index) => {
      const parentGradeOptionId = option.parentGradeOptionId ?? null;
      if (option.dimension === "grade" && parentGradeOptionId !== null) {
        context.addIssue({
          code: "custom",
          message: "年级不能隶属于其他年级",
          path: ["attributeOptions", index, "parentGradeOptionId"],
        });
        return;
      }
      if (option.dimension === "class") {
        if (parentGradeOptionId === null) {
          context.addIssue({
            code: "custom",
            message: "班级必须隶属于具体年级",
            path: ["attributeOptions", index, "parentGradeOptionId"],
          });
          return;
        }
        const parent = optionById.get(parentGradeOptionId);
        if (parent === undefined || parent.dimension !== "grade") {
          context.addIssue({
            code: "custom",
            message: "班级必须关联当前配置中的有效年级",
            path: ["attributeOptions", index, "parentGradeOptionId"],
          });
        }
      }
    });
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
    issues.push({ code: "NO_ENABLED_PATTERN", path: "patterns", message: "至少启用一个有效分支" });
  }
  patterns.forEach((pattern, patternIndex) => {
    if (!pattern.enabled) return;
    if (pattern.constraints.length === 0) {
      issues.push({
        code: "EMPTY_PATTERN",
        path: `patterns.${patternIndex}.constraints`,
        message: "启用的分支至少需要一个条件",
      });
    }
    const constraints = pattern.constraints.map((constraint, constraintIndex) => {
      if (constraint.startPosition + constraint.width - 1 > pattern.totalLength) {
        issues.push({
          code: "CONSTRAINT_OUT_OF_BOUNDS",
          path: `patterns.${patternIndex}.constraints.${constraintIndex}`,
          message: "条件位置超出号码总位数",
        });
      }
      const normalized = normalizeBibRanges(constraint.ranges, constraint.width);
      if (constraint.ranges.some((range) => !bibRangeValidForWidth(range, constraint.width))) {
        issues.push({
          code: "INVALID_RANGE_WIDTH",
          path: `patterns.${patternIndex}.constraints.${constraintIndex}.ranges`,
          message: "允许范围必须与读取位数一致，且起点不能大于终点",
        });
      }
      if (normalized.length === 0) {
        issues.push({
          code: "EMPTY_CONSTRAINT",
          path: `patterns.${patternIndex}.constraints.${constraintIndex}.ranges`,
          message: "条件没有有效允许范围",
        });
      }
      return {
        startPosition: constraint.startPosition,
        width: constraint.width,
        ranges: normalized,
      };
    });
    if (
      !issues.some((issue) => issue.path.startsWith(`patterns.${patternIndex}.`)) &&
      !hasSatisfyingNumber(pattern.totalLength, constraints)
    ) {
      issues.push({
        code: "UNSATISFIABLE_PATTERN",
        path: `patterns.${patternIndex}`,
        message: "分支内条件互相冲突，没有号码可以通过",
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

function attributeRuleIndex(number: string, rule: BibAttributeRuleInput): number | null {
  const value = number.slice(rule.startPosition - 1, rule.startPosition - 1 + rule.width);
  if (value.length !== rule.width || !/^\d+$/u.test(value)) return null;
  const index = Number(value) - rule.firstValue;
  return Number.isSafeInteger(index) && index >= 0 ? index : null;
}

function attributeOptionAtOrdinal(
  options: readonly BibAttributeOptionInput[],
  dimension: BibAttributeDimension,
  ordinal: number | null,
  parentGradeOptionId?: string,
): BibAttributeOptionInput | undefined {
  if (ordinal === null) return undefined;
  return options.find(
    (option) =>
      option.enabled &&
      option.dimension === dimension &&
      option.ordinal === ordinal &&
      (dimension === "grade" || option.parentGradeOptionId === parentGradeOptionId),
  );
}

export function validateBibAttributeRules(
  patterns: readonly BibPatternInput[],
  options: readonly BibAttributeOptionInput[],
  rules: readonly BibAttributeRuleInput[],
): { readonly usable: boolean; readonly issues: readonly BibValidationIssue[] } {
  const issues: BibValidationIssue[] = [];
  const dimensionCounts = new Map<BibAttributeDimension, number>();
  rules.forEach((rule, ruleIndex) => {
    dimensionCounts.set(rule.dimension, (dimensionCounts.get(rule.dimension) ?? 0) + 1);
    if (
      !patterns.some(
        (pattern) => pattern.enabled && rule.startPosition + rule.width - 1 <= pattern.totalLength,
      )
    ) {
      issues.push({
        code: "ATTRIBUTE_RULE_OUT_OF_BOUNDS",
        path: `attributeRules.${ruleIndex}`,
        message: "属性解析位置未落入任何已启用号码模式",
      });
    }
    if (rule.firstValue > 10 ** rule.width - 1) {
      issues.push({
        code: "ATTRIBUTE_RULE_FIRST_VALUE_OUT_OF_RANGE",
        path: `attributeRules.${ruleIndex}.firstValue`,
        message: "起始序号超出当前读取位数可表示的范围",
      });
    }
  });
  for (const [dimension, count] of dimensionCounts) {
    if (count > 1) {
      issues.push({
        code: "DUPLICATE_ATTRIBUTE_RULE",
        path: "attributeRules",
        message: `${dimension === "grade" ? "年级" : "班级"}只能配置一条解析规则`,
      });
    }
  }

  const gradeRule = rules.find((rule) => rule.dimension === "grade");
  const classRule = rules.find((rule) => rule.dimension === "class");

  const enabledOptions = options.filter((option) => option.enabled);
  const sortOrderScopes = new Map<string, Set<number>>();
  for (const option of enabledOptions) {
    const scope =
      option.dimension === "grade"
        ? "grade"
        : `class:${option.parentGradeOptionId ?? "missing"}`;
    const used = sortOrderScopes.get(scope) ?? new Set<number>();
    if (used.has(option.ordinal)) {
      issues.push({
        code: "DUPLICATE_ATTRIBUTE_ORDINAL",
        path: "attributeOptions",
        message:
          option.dimension === "grade"
            ? "启用年级的顺序位不能重复"
            : "同一年级下启用班级的顺序位不能重复",
      });
    }
    used.add(option.ordinal);
    sortOrderScopes.set(scope, used);
  }
  if (classRule !== undefined && gradeRule === undefined) {
    issues.push({
      code: "CLASS_RULE_REQUIRES_GRADE_RULE",
      path: "attributeRules",
      message: "班级按年级分组，启用班级解析前必须先配置年级解析",
    });
  }
  if (
    gradeRule !== undefined &&
    !options.some((option) => option.dimension === "grade" && option.enabled)
  ) {
    issues.push({
      code: "ATTRIBUTE_RULE_WITHOUT_OPTIONS",
      path: "attributeRules",
      message: "已配置年级解析，但没有启用的年级",
    });
  }
  if (
    classRule !== undefined &&
    !options.some((option) => option.dimension === "class" && option.enabled)
  ) {
    issues.push({
      code: "ATTRIBUTE_RULE_WITHOUT_OPTIONS",
      path: "attributeRules",
      message: "已配置班级解析，但没有启用的班级",
    });
  }

  const ruleByDimension = new Map(rules.map((rule) => [rule.dimension, rule]));
  options.forEach((option, optionIndex) => {
    if (!option.enabled) return;
    const rule = ruleByDimension.get(option.dimension);
    if (rule === undefined) return;
    if (rule.firstValue + option.ordinal > 10 ** rule.width - 1) {
      issues.push({
        code: "ATTRIBUTE_ORDINAL_OUT_OF_RANGE",
        path: `attributeOptions.${optionIndex}.ordinal`,
        message: `${option.dimension === "grade" ? "年级" : "班级"}编码槽位超出当前读取位数可表示的范围`,
      });
    }
  });
  return { usable: issues.length === 0, issues };
}

export function deriveBibAttributes(
  number: string,
  rules: readonly BibAttributeRuleInput[],
  options: readonly BibAttributeOptionInput[],
): { readonly gradeOptionId: string | null; readonly classOptionId: string | null } {
  const gradeRule = rules.find((rule) => rule.dimension === "grade");
  const gradeOrdinal = gradeRule === undefined ? null : attributeRuleIndex(number, gradeRule);
  const gradeOption = attributeOptionAtOrdinal(options, "grade", gradeOrdinal);

  const classRule = rules.find((rule) => rule.dimension === "class");
  const classOrdinal = classRule === undefined ? null : attributeRuleIndex(number, classRule);
  const classOption =
    gradeOption === undefined
      ? undefined
      : attributeOptionAtOrdinal(options, "class", classOrdinal, gradeOption.id);

  return {
    gradeOptionId: gradeOption?.id ?? null,
    classOptionId: classOption?.id ?? null,
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
