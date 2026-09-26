"use client";

import {
  type BibAttributeDimension,
  type BibAttributeMappingInput,
  type BibAttributeOptionInput,
  type BibConfigUpdate,
  type BibConfigView,
  type BibConstraintInput,
  type BibPatternInput,
  type BibTestResponse,
  deriveBibAttributes,
  evaluateBibNumber,
  normalizeBibNumber,
  validateBibMappings,
  validateBibRuleSet,
} from "@photostream/contracts";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  FlaskConicalIcon,
  PlusIcon,
  SaveIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorDialog } from "@/components/ui/error-dialog";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { clientMutation } from "@/lib/client-api";

interface SimpleConstraintDraft {
  readonly id: string;
  readonly startPosition: number;
  readonly width: number;
  readonly start: string;
  readonly end: string;
}

interface SimpleConditionalRuleDraft {
  readonly id: string;
  readonly when: SimpleConstraintDraft;
  readonly then: SimpleConstraintDraft;
}

interface SimpleBibRuleDraft {
  readonly totalLength: number;
  readonly baseRules: readonly SimpleConstraintDraft[];
  readonly conditionalRules: readonly SimpleConditionalRuleDraft[];
  readonly compatible: boolean;
  readonly dirty: boolean;
}

function newSimpleConstraint(startPosition = 1, width = 1): SimpleConstraintDraft {
  return {
    id: crypto.randomUUID(),
    startPosition,
    width,
    start: "0".repeat(width),
    end: "9".repeat(width),
  };
}

function resizeSimpleConstraint(
  constraint: SimpleConstraintDraft,
  width: number,
): SimpleConstraintDraft {
  return {
    ...constraint,
    width,
    start: "0".repeat(width),
    end: "9".repeat(width),
  };
}

function simpleConstraintIsRepresentable(constraint: BibConstraintInput): boolean {
  return constraint.ranges.length === 1;
}

function simpleConstraintFromBib(constraint: BibConstraintInput): SimpleConstraintDraft | null {
  const range = constraint.ranges.length === 1 ? constraint.ranges[0] : undefined;
  if (range === undefined) return null;
  return {
    id: crypto.randomUUID(),
    startPosition: constraint.startPosition,
    width: constraint.width,
    start: range.start,
    end: range.end,
  };
}

function constraintSignature(constraint: BibConstraintInput): string | null {
  const range = constraint.ranges.length === 1 ? constraint.ranges[0] : undefined;
  return range === undefined
    ? null
    : `${constraint.startPosition}:${constraint.width}:${range.start}:${range.end}`;
}

function simpleRuleDraftFromPatterns(patterns: readonly BibPatternInput[]): SimpleBibRuleDraft {
  const enabled = patterns.filter((pattern) => pattern.enabled);
  const totalLength = enabled[0]?.totalLength ?? patterns[0]?.totalLength ?? 5;
  if (enabled.length === 0) {
    return {
      totalLength,
      baseRules: [],
      conditionalRules: [],
      compatible: patterns.length === 0,
      dirty: false,
    };
  }

  const structurallySimple =
    enabled.length === patterns.length &&
    enabled.every(
      (pattern) =>
        pattern.totalLength === totalLength &&
        pattern.constraints.every(simpleConstraintIsRepresentable),
    );
  if (!structurallySimple) {
    return {
      totalLength,
      baseRules: enabled[0]?.constraints
        .map(simpleConstraintFromBib)
        .filter((constraint): constraint is SimpleConstraintDraft => constraint !== null) ?? [],
      conditionalRules: [],
      compatible: false,
      dirty: false,
    };
  }

  if (enabled.length === 1) {
    return {
      totalLength,
      baseRules: enabled[0]?.constraints
        .map(simpleConstraintFromBib)
        .filter((constraint): constraint is SimpleConstraintDraft => constraint !== null) ?? [],
      conditionalRules: [],
      compatible: true,
      dirty: false,
    };
  }

  const first = enabled[0];
  if (first === undefined) {
    return { totalLength, baseRules: [], conditionalRules: [], compatible: true, dirty: false };
  }
  const commonSignatures = new Set(
    first.constraints
      .map(constraintSignature)
      .filter(
        (signature): signature is string =>
          signature !== null &&
          enabled.every((pattern) =>
            pattern.constraints.some((constraint) => constraintSignature(constraint) === signature),
          ),
      ),
  );
  const baseRules = first.constraints
    .filter((constraint) => {
      const signature = constraintSignature(constraint);
      return signature !== null && commonSignatures.has(signature);
    })
    .map(simpleConstraintFromBib)
    .filter((constraint): constraint is SimpleConstraintDraft => constraint !== null);

  const conditionalRules: SimpleConditionalRuleDraft[] = [];
  for (const pattern of enabled) {
    const remaining = pattern.constraints.filter((constraint) => {
      const signature = constraintSignature(constraint);
      return signature === null || !commonSignatures.has(signature);
    });
    if (remaining.length !== 2) {
      return { totalLength, baseRules, conditionalRules: [], compatible: false, dirty: false };
    }
    const when = simpleConstraintFromBib(remaining[0] as BibConstraintInput);
    const then = simpleConstraintFromBib(remaining[1] as BibConstraintInput);
    if (when === null || then === null) {
      return { totalLength, baseRules, conditionalRules: [], compatible: false, dirty: false };
    }
    conditionalRules.push({ id: crypto.randomUUID(), when, then });
  }

  return { totalLength, baseRules, conditionalRules, compatible: true, dirty: false };
}

function compiledConstraint(
  constraint: SimpleConstraintDraft,
  sortOrder: number,
): BibConstraintInput {
  return {
    id: crypto.randomUUID(),
    startPosition: constraint.startPosition,
    width: constraint.width,
    ranges: [{ id: crypto.randomUUID(), start: constraint.start, end: constraint.end }],
    sortOrder,
  };
}

function compileSimpleRuleDraft(draft: SimpleBibRuleDraft): BibPatternInput[] {
  const makeBaseConstraints = () =>
    draft.baseRules.map((constraint, index) => compiledConstraint(constraint, index));
  if (draft.conditionalRules.length === 0) {
    if (draft.baseRules.length === 0) return [];
    return [
      {
        id: crypto.randomUUID(),
        totalLength: draft.totalLength,
        sortOrder: 0,
        enabled: true,
        constraints: makeBaseConstraints(),
      },
    ];
  }
  return draft.conditionalRules.map((rule, index) => {
    const base = makeBaseConstraints();
    return {
      id: crypto.randomUUID(),
      totalLength: draft.totalLength,
      sortOrder: index,
      enabled: true,
      constraints: [
        ...base,
        compiledConstraint(rule.when, base.length),
        compiledConstraint(rule.then, base.length + 1),
      ],
    };
  });
}

function simpleConstraintSummary(constraint: SimpleConstraintDraft): string {
  const last = constraint.startPosition + constraint.width - 1;
  const position =
    constraint.width === 1
      ? `第 ${constraint.startPosition} 位`
      : `第 ${constraint.startPosition}–${last} 位`;
  const range =
    constraint.start === constraint.end
      ? constraint.start
      : `${constraint.start}–${constraint.end}`;
  return `${position}为 ${range}`;
}

function simpleRuleSummary(draft: SimpleBibRuleDraft): string {
  const parts = [`号码固定为 ${draft.totalLength} 位`];
  parts.push(...draft.baseRules.map((rule) => simpleConstraintSummary(rule)));
  parts.push(
    ...draft.conditionalRules.map(
      (rule) =>
        `当${simpleConstraintSummary(rule.when)}时，${simpleConstraintSummary(rule.then)}`,
    ),
  );
  return parts.join("；");
}

function simpleConstraint(
  startPosition: number,
  width: number,
  start: string,
  end: string,
): SimpleConstraintDraft {
  return { id: crypto.randomUUID(), startPosition, width, start, end };
}

function schoolFiveDigitPresetDraft(): SimpleBibRuleDraft {
  const conditionalRule = (
    whenStart: string,
    whenEnd: string,
    thenEnd: string,
  ): SimpleConditionalRuleDraft => ({
    id: crypto.randomUUID(),
    when: simpleConstraint(1, 1, whenStart, whenEnd),
    then: simpleConstraint(2, 2, "01", thenEnd),
  });
  return {
    totalLength: 5,
    baseRules: [simpleConstraint(1, 1, "1", "6")],
    conditionalRules: [
      conditionalRule("1", "2", "10"),
      conditionalRule("3", "3", "11"),
      conditionalRule("4", "4", "08"),
      conditionalRule("5", "6", "06"),
    ],
    compatible: true,
    dirty: true,
  };
}

function simpleConstraintKey(constraint: SimpleConstraintDraft): string {
  return [
    constraint.startPosition,
    constraint.width,
    constraint.start,
    constraint.end,
  ].join(":");
}

function isSchoolFiveDigitPreset(draft: SimpleBibRuleDraft): boolean {
  if (draft.totalLength !== 5 || draft.baseRules.length !== 1) return false;
  const base = draft.baseRules[0];
  if (base === undefined || simpleConstraintKey(base) !== "1:1:1:6") return false;

  const actual = draft.conditionalRules
    .map((rule) => `${simpleConstraintKey(rule.when)}>${simpleConstraintKey(rule.then)}`)
    .toSorted();
  const expected = [
    "1:1:1:2>2:2:01:10",
    "1:1:3:3>2:2:01:11",
    "1:1:4:4>2:2:01:08",
    "1:1:5:6>2:2:01:06",
  ].toSorted();
  return (
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function requestFrom(config: BibConfigView): BibConfigUpdate {
  const attributeOptions = config.attributeOptions.filter(
    (option) => option.dimension === "grade" || option.parentGradeOptionId != null,
  );
  const optionIds = new Set(attributeOptions.map((option) => option.id));
  return {
    recognitionEnabled: config.recognitionEnabled,
    searchEnabled: config.searchEnabled,
    modelVersion: config.modelVersion,
    patterns: config.patterns.map((pattern, patternIndex) => ({
      ...pattern,
      sortOrder: patternIndex,
      constraints: pattern.constraints.map((constraint, constraintIndex) => ({
        ...constraint,
        sortOrder: constraintIndex,
      })),
    })),
    attributeOptions,
    mappings: config.mappings.filter((mapping) => optionIds.has(mapping.outputOptionId)),
  };
}

function optionLabel(option: BibAttributeOptionInput): string {
  const displayName = option.displayName.trim();
  if (displayName.length > 0) return displayName;
  return option.dimension === "grade" ? "未命名年级" : "未命名班级";
}

function dimensionLabel(dimension: BibAttributeDimension): string {
  return dimension === "grade" ? "年级" : "班级";
}

function orderedOptions(
  options: readonly BibAttributeOptionInput[],
  dimension: BibAttributeDimension,
): BibAttributeOptionInput[] {
  return options
    .filter((option) => option.dimension === dimension)
    .toSorted(
      (left, right) =>
        left.sortOrder - right.sortOrder ||
        left.displayName.localeCompare(right.displayName, "zh-CN") ||
        left.id.localeCompare(right.id),
    );
}

function allClassesForGrade(
  options: readonly BibAttributeOptionInput[],
  gradeOptionId: string,
): BibAttributeOptionInput[] {
  return orderedOptions(options, "class").filter(
    (option) => option.parentGradeOptionId === gradeOptionId,
  );
}

function classesForGrade(
  options: readonly BibAttributeOptionInput[],
  gradeOptionId: string,
): BibAttributeOptionInput[] {
  return allClassesForGrade(options, gradeOptionId).filter((option) => option.enabled);
}

function mappingOptionLabel(
  option: BibAttributeOptionInput,
  options: readonly BibAttributeOptionInput[],
): string {
  if (option.dimension !== "class") {
    return optionLabel(option);
  }
  const grade = options.find(
    (candidate) => candidate.id === option.parentGradeOptionId && candidate.dimension === "grade",
  );
  return grade === undefined
    ? optionLabel(option)
    : `${optionLabel(grade)} · ${optionLabel(option)}`;
}

const schoolGradeNames = ["初一", "初二", "初三", "高一", "高二", "高三"] as const;

function exactAttributeMapping(
  dimension: BibAttributeDimension,
  startPosition: number,
  width: number,
  value: string,
  outputOptionId: string,
  sortOrder: number,
): BibAttributeMappingInput {
  return {
    dimension,
    startPosition,
    width,
    ranges: [{ start: value, end: value }],
    outputOptionId,
    sortOrder,
  };
}

function schoolGradeClassMappingPreset(options: readonly BibAttributeOptionInput[]): {
  readonly mappings: readonly BibAttributeMappingInput[];
  readonly missingGradeNames: readonly string[];
} {
  const grades = orderedOptions(options, "grade");
  const resolvedGrades = schoolGradeNames.map((displayName) =>
    grades.find((grade) => grade.enabled && grade.displayName.trim() === displayName),
  );
  const missingGradeNames = schoolGradeNames.filter(
    (_, index) => resolvedGrades[index] === undefined,
  );
  if (missingGradeNames.length > 0) {
    return { mappings: [], missingGradeNames };
  }

  const mappings: BibAttributeMappingInput[] = [];
  let gradeSortOrder = 0;
  let classSortOrder = 0;
  resolvedGrades.forEach((grade, gradeIndex) => {
    if (grade === undefined) return;
    mappings.push(
      exactAttributeMapping(
        "grade",
        1,
        1,
        String(gradeIndex + 1),
        grade.id,
        gradeSortOrder,
      ),
    );
    gradeSortOrder += 1;

    classesForGrade(options, grade.id)
      .slice(0, 11)
      .forEach((classOption, classIndex) => {
        mappings.push(
          exactAttributeMapping(
            "class",
            2,
            2,
            String(classIndex + 1).padStart(2, "0"),
            classOption.id,
            classSortOrder,
          ),
        );
        classSortOrder += 1;
      });
  });
  return { mappings, missingGradeNames: [] };
}

function mappingPresetSignature(mapping: BibAttributeMappingInput): string {
  const ranges = mapping.ranges
    .map((range) => `${range.start}:${range.end}`)
    .toSorted()
    .join(",");
  return [
    mapping.dimension,
    mapping.startPosition,
    mapping.width,
    ranges,
    mapping.outputOptionId,
  ].join("|");
}

function isSchoolGradeClassMappingPreset(
  options: readonly BibAttributeOptionInput[],
  mappings: readonly BibAttributeMappingInput[],
): boolean {
  const preset = schoolGradeClassMappingPreset(options);
  if (preset.missingGradeNames.length > 0 || preset.mappings.length !== mappings.length) {
    return false;
  }
  const expected = preset.mappings.map(mappingPresetSignature).toSorted();
  const actual = mappings.map(mappingPresetSignature).toSorted();
  return actual.every((signature, index) => signature === expected[index]);
}

function numberDraftIsValid(value: string, min: number, max?: number): boolean {
  if (value.trim().length === 0) return false;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && (max === undefined || parsed <= max);
}

function DraftNumberInput({
  id,
  max,
  min,
  onValueChange,
  value,
}: Readonly<{
  id: string;
  max?: number;
  min: number;
  onValueChange: (value: number) => void;
  value: number;
}>) {
  const [draft, setDraft] = useState(() => String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  return (
    <Input
      id={id}
      max={max}
      min={min}
      onBlur={() => {
        if (!numberDraftIsValid(draft, min, max)) setDraft(String(value));
      }}
      onChange={(event) => {
        const { value: next } = event.currentTarget;
        setDraft(next);
        if (!numberDraftIsValid(next, min, max)) return;
        onValueChange(Number(next));
      }}
      type="number"
      value={draft}
    />
  );
}

export function BibConfigEditor({ initial }: Readonly<{ initial: BibConfigView }>) {
  const [config, setConfig] = useState<BibConfigUpdate>(() => requestFrom(initial));
  const [ruleDraft, setRuleDraft] = useState<SimpleBibRuleDraft>(() =>
    simpleRuleDraftFromPatterns(initial.patterns),
  );
  const [rulePreset, setRulePreset] = useState<"school-five-digit" | null>(() =>
    isSchoolFiveDigitPreset(simpleRuleDraftFromPatterns(initial.patterns))
      ? "school-five-digit"
      : null,
  );
  const [mappingPreset, setMappingPreset] = useState<"school-grade-class" | null>(() =>
    isSchoolGradeClassMappingPreset(initial.attributeOptions, initial.mappings)
      ? "school-grade-class"
      : null,
  );
  const [saved, setSaved] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testNumber, setTestNumber] = useState("");
  const [testResult, setTestResult] = useState<BibTestResponse | null>(null);
  const effectivePatterns = useMemo(
    () => (ruleDraft.dirty ? compileSimpleRuleDraft(ruleDraft) : config.patterns),
    [config.patterns, ruleDraft],
  );
  const validation = useMemo(() => {
    const rule = validateBibRuleSet(effectivePatterns);
    const mapping = validateBibMappings(
      effectivePatterns,
      config.attributeOptions,
      config.mappings,
    );
    const optionIssues = config.attributeOptions.flatMap((option, index) => {
      const displayName = option.displayName.trim();
      if (displayName.length === 0) {
        return [
          {
            code: "EMPTY_ATTRIBUTE_OPTION_NAME",
            path: `attributeOptions.${index}.displayName`,
            message: `${dimensionLabel(option.dimension)}名称不能为空`,
          },
        ];
      }
      const parentGradeOptionId = option.parentGradeOptionId ?? null;
      if (option.dimension === "grade" && parentGradeOptionId !== null) {
        return [
          {
            code: "INVALID_ATTRIBUTE_HIERARCHY",
            path: `attributeOptions.${index}.parentGradeOptionId`,
            message: "年级不能隶属于其他年级",
          },
        ];
      }
      if (option.dimension === "class") {
        if (parentGradeOptionId === null) {
          return [
            {
              code: "INVALID_ATTRIBUTE_HIERARCHY",
              path: `attributeOptions.${index}.parentGradeOptionId`,
              message: "班级必须隶属于具体年级",
            },
          ];
        }
        if (
          !config.attributeOptions.some(
            (candidate) => candidate.id === parentGradeOptionId && candidate.dimension === "grade",
          )
        ) {
          return [
            {
              code: "INVALID_ATTRIBUTE_HIERARCHY",
              path: `attributeOptions.${index}.parentGradeOptionId`,
              message: "班级关联的年级不存在",
            },
          ];
        }
      }
      const duplicateIndex = config.attributeOptions.findIndex(
        (candidate, candidateIndex) =>
          candidateIndex < index &&
          candidate.dimension === option.dimension &&
          (option.dimension === "grade" ||
            (candidate.parentGradeOptionId ?? null) === parentGradeOptionId) &&
          candidate.displayName.trim().localeCompare(displayName, "zh-CN", {
            sensitivity: "accent",
          }) === 0,
      );
      return duplicateIndex === -1
        ? []
        : [
            {
              code: "DUPLICATE_ATTRIBUTE_OPTION_NAME",
              path: `attributeOptions.${index}.displayName`,
              message:
                option.dimension === "grade" ? "年级名称不能重复" : "同一年级下班级名称不能重复",
            },
          ];
    });
    return { rule, mapping, issues: [...rule.issues, ...mapping.issues, ...optionIssues] };
  }, [config, effectivePatterns]);
  const localTestResult = useMemo(() => {
    const normalizedNumber = normalizeBibNumber(testNumber);
    if (normalizedNumber === null) return null;
    const evaluation = evaluateBibNumber(normalizedNumber, effectivePatterns);
    const derived = evaluation.valid
      ? deriveBibAttributes(normalizedNumber, config.mappings, config.attributeOptions)
      : { gradeOptionId: null, classOptionId: null, matchedMappingIds: [] };
    const classOption =
      derived.classOptionId === null
        ? undefined
        : config.attributeOptions.find(
            (option) => option.id === derived.classOptionId && option.dimension === "class",
          );
    const attributes =
      classOption?.parentGradeOptionId != null &&
      classOption.parentGradeOptionId !== derived.gradeOptionId
        ? { ...derived, classOptionId: null }
        : derived;
    return { normalizedNumber, ...evaluation, ...attributes };
  }, [config, effectivePatterns, testNumber]);
  const testNumberInvalid = testNumber.length > 0 && localTestResult === null;

  function editRuleDraft(update: (current: SimpleBibRuleDraft) => SimpleBibRuleDraft): void {
    setRulePreset(null);
    setRuleDraft((current) => ({ ...update(current), compatible: true, dirty: true }));
  }

  function applyRulePreset(value: string | null): void {
    if (value !== "school-five-digit") {
      setRulePreset(null);
      return;
    }
    setRulePreset("school-five-digit");
    setRuleDraft(schoolFiveDigitPresetDraft());
  }

  function updateBaseRule(
    ruleIndex: number,
    update: (rule: SimpleConstraintDraft) => SimpleConstraintDraft,
  ): void {
    editRuleDraft((current) => ({
      ...current,
      baseRules: current.baseRules.map((rule, index) =>
        index === ruleIndex ? update(rule) : rule,
      ),
    }));
  }

  function updateConditionalRule(
    ruleIndex: number,
    side: "when" | "then",
    update: (rule: SimpleConstraintDraft) => SimpleConstraintDraft,
  ): void {
    editRuleDraft((current) => ({
      ...current,
      conditionalRules: current.conditionalRules.map((rule, index) =>
        index === ruleIndex ? { ...rule, [side]: update(rule[side]) } : rule,
      ),
    }));
  }

  function updateOption(
    optionId: string,
    update: (option: BibAttributeOptionInput) => BibAttributeOptionInput,
  ) {
    setMappingPreset(null);
    setConfig((current) => ({
      ...current,
      attributeOptions: current.attributeOptions.map((option) =>
        option.id === optionId ? update(option) : option,
      ),
    }));
  }

  function moveOption(optionId: string, direction: -1 | 1): void {
    setMappingPreset(null);
    setConfig((current) => {
      const option = current.attributeOptions.find((item) => item.id === optionId);
      if (option === undefined) return current;
      const ordered = orderedOptions(current.attributeOptions, option.dimension);
      const index = ordered.findIndex((item) => item.id === optionId);
      const targetIndex = index + direction;
      if (index === -1 || targetIndex < 0 || targetIndex >= ordered.length) return current;
      const reordered = [...ordered];
      const [moving] = reordered.splice(index, 1);
      if (moving === undefined) return current;
      reordered.splice(targetIndex, 0, moving);
      const sortOrderById = new Map(reordered.map((item, order) => [item.id, order]));
      return {
        ...current,
        attributeOptions: current.attributeOptions.map((item) =>
          item.dimension === option.dimension
            ? { ...item, sortOrder: sortOrderById.get(item.id) ?? item.sortOrder }
            : item,
        ),
      };
    });
  }

  function removeOption(optionId: string): void {
    setMappingPreset(null);
    setConfig((current) => {
      const removed = current.attributeOptions.find((option) => option.id === optionId);
      if (removed === undefined) return current;
      const removedIds = new Set([
        optionId,
        ...(removed.dimension === "grade"
          ? current.attributeOptions
              .filter(
                (option) =>
                  option.dimension === "class" && option.parentGradeOptionId === removed.id,
              )
              .map((option) => option.id)
          : []),
      ]);
      const remaining = current.attributeOptions.filter((option) => !removedIds.has(option.id));
      const gradeSortOrderById = new Map(
        orderedOptions(remaining, "grade").map((option, index) => [option.id, index]),
      );
      return {
        ...current,
        attributeOptions: remaining.map((option) =>
          option.dimension === "grade"
            ? { ...option, sortOrder: gradeSortOrderById.get(option.id) ?? option.sortOrder }
            : option,
        ),
        mappings: current.mappings.filter((mapping) => !removedIds.has(mapping.outputOptionId)),
      };
    });
  }

  function updateMapping(
    mappingIndex: number,
    update: (mapping: BibAttributeMappingInput) => BibAttributeMappingInput,
  ) {
    setMappingPreset(null);
    setConfig((current) => ({
      ...current,
      mappings: current.mappings.map((mapping, index) =>
        index === mappingIndex ? update(mapping) : mapping,
      ),
    }));
  }

  function addGrade(): void {
    setMappingPreset(null);
    setConfig((current) => {
      const existing = orderedOptions(current.attributeOptions, "grade");
      const usedNames = new Set(existing.map((option) => option.displayName.trim()));
      const baseName = "新年级";
      let displayName = baseName;
      let suffix = 2;
      while (usedNames.has(displayName)) {
        displayName = `${baseName} ${suffix}`;
        suffix += 1;
      }
      return {
        ...current,
        attributeOptions: [
          ...current.attributeOptions,
          {
            id: crypto.randomUUID(),
            dimension: "grade",
            displayName,
            sortOrder:
              existing.reduce((maximum, option) => Math.max(maximum, option.sortOrder), -1) + 1,
            enabled: true,
            parentGradeOptionId: null,
          },
        ],
      };
    });
  }

  function setGradeClassCount(gradeOptionId: string, requestedCount: number): void {
    setMappingPreset(null);
    setConfig((current) => {
      const grade = current.attributeOptions.find(
        (option) => option.id === gradeOptionId && option.dimension === "grade",
      );
      if (grade === undefined) return current;
      const existing = allClassesForGrade(current.attributeOptions, gradeOptionId);
      const otherOptionCount = current.attributeOptions.length - existing.length;
      const classCount = Math.max(0, Math.min(requestedCount, 30, 100 - otherOptionCount));
      const retainedIds = new Set(existing.slice(0, classCount).map((option) => option.id));
      const nextClasses = Array.from(
        { length: Math.max(classCount, existing.length) },
        (_, index) => {
          const currentClass = existing[index];
          if (index >= classCount && currentClass !== undefined) {
            return { ...currentClass, enabled: false };
          }
          return {
            id: currentClass?.id ?? crypto.randomUUID(),
            dimension: "class" as const,
            displayName: `${index + 1}班`,
            sortOrder: index,
            enabled: true,
            parentGradeOptionId: gradeOptionId,
          };
        },
      );
      const retiredIds = new Set(
        existing.filter((option) => !retainedIds.has(option.id)).map((option) => option.id),
      );
      return {
        ...current,
        attributeOptions: [
          ...current.attributeOptions.filter(
            (option) =>
              !(option.dimension === "class" && option.parentGradeOptionId === gradeOptionId),
          ),
          ...nextClasses,
        ],
        mappings: current.mappings.filter((mapping) => !retiredIds.has(mapping.outputOptionId)),
      };
    });
  }

  function setGradeEnabled(gradeOptionId: string, enabled: boolean): void {
    updateOption(gradeOptionId, (grade) => ({ ...grade, enabled }));
  }

  function applyMappingPreset(value: string | null): void {
    if (value !== "school-grade-class") {
      setMappingPreset(null);
      return;
    }
    const preset = schoolGradeClassMappingPreset(config.attributeOptions);
    if (preset.missingGradeNames.length > 0) {
      setMappingPreset(null);
      setError(`请先创建并启用以下年级：${preset.missingGradeNames.join("、")}`);
      return;
    }
    setError(null);
    setMappingPreset("school-grade-class");
    setConfig((current) => ({ ...current, mappings: [...preset.mappings] }));
  }

  function addMapping(dimension: BibAttributeDimension): void {
    setMappingPreset(null);
    const output = orderedOptions(config.attributeOptions, dimension).find(
      (option) => option.enabled,
    );
    if (output === undefined) {
      setError(dimension === "grade" ? "请先创建启用的年级选项" : "请先创建启用的班级选项");
      return;
    }
    setConfig((current) => ({
      ...current,
      mappings: [
        ...current.mappings,
        {
          id: crypto.randomUUID(),
          dimension,
          startPosition: 1,
          width: 1,
          ranges: [{ id: crypto.randomUUID(), start: "0", end: "9" }],
          outputOptionId: output.id,
          sortOrder: current.mappings.filter((mapping) => mapping.dimension === dimension).length,
        },
      ],
    }));
  }

  async function save(): Promise<void> {
    if (pending) return;
    const attributeOptionIssue = validation.issues.find(
      (issue) =>
        issue.code === "EMPTY_ATTRIBUTE_OPTION_NAME" ||
        issue.code === "DUPLICATE_ATTRIBUTE_OPTION_NAME" ||
        issue.code === "INVALID_ATTRIBUTE_HIERARCHY",
    );
    if (attributeOptionIssue !== undefined) {
      setError(attributeOptionIssue.message);
      return;
    }
    if (
      (config.recognitionEnabled || config.searchEnabled) &&
      (!validation.rule.usable || !validation.mapping.usable)
    ) {
      setError("当前规则或映射存在冲突，关闭开关后可保存草稿，不能直接启用。");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const updated = await clientMutation<BibConfigView>(
        `/api/v1/albums/${saved.albumId}/bib-config`,
        { method: "PUT", body: { ...config, patterns: effectivePatterns } },
      );
      const updatedRuleDraft = simpleRuleDraftFromPatterns(updated.patterns);
      setSaved(updated);
      const updatedConfig = requestFrom(updated);
      setConfig(updatedConfig);
      setRuleDraft(updatedRuleDraft);
      setRulePreset(isSchoolFiveDigitPreset(updatedRuleDraft) ? "school-five-digit" : null);
      setMappingPreset(
        isSchoolGradeClassMappingPreset(updated.attributeOptions, updated.mappings)
          ? "school-grade-class"
          : null,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "号码配置保存失败");
    } finally {
      setPending(false);
    }
  }

  async function test(): Promise<void> {
    if (pending || testNumber.length === 0) return;
    setPending(true);
    setError(null);
    try {
      setTestResult(
        await clientMutation<BibTestResponse>(`/api/v1/albums/${saved.albumId}/bib-config/test`, {
          body: { number: normalizeBibNumber(testNumber) ?? testNumber },
        }),
      );
    } catch (caught) {
      setTestResult(null);
      setError(caught instanceof Error ? caught.message : "测试号码失败");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>功能开关</CardTitle>
          <CardDescription>搜索只能用于口令相册。</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field
              data-disabled={saved.automationStatus === "disabled" || undefined}
              orientation="horizontal"
            >
              <FieldContent>
                <FieldLabel htmlFor="bib-recognition-enabled">上传端本地号码识别</FieldLabel>
                <FieldDescription>不阻塞照片上传与发布，失败后保持待复核。</FieldDescription>
              </FieldContent>
              <Switch
                checked={config.recognitionEnabled}
                disabled={saved.automationStatus === "disabled"}
                id="bib-recognition-enabled"
                onCheckedChange={(checked) =>
                  setConfig((current) => ({ ...current, recognitionEnabled: checked }))
                }
              />
            </Field>
            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel htmlFor="bib-search-enabled">观众精确号码搜索</FieldLabel>
                <FieldDescription>未确认、失效和未发布照片始终不可搜索。</FieldDescription>
              </FieldContent>
              <Switch
                checked={config.searchEnabled}
                id="bib-search-enabled"
                onCheckedChange={(checked) =>
                  setConfig((current) => ({ ...current, searchEnabled: checked }))
                }
              />
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>号码规则</CardTitle>
          <CardDescription>
            先设置号码总位数和始终生效的基础限制，再按“当…时…”添加条件限制。系统会自动转换为底层匹配规则，无需手动拆分 OR/AND 分支。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {!ruleDraft.compatible && !ruleDraft.dirty ? (
            <Alert>
              <AlertTitle>现有规则包含较复杂结构</AlertTitle>
              <AlertDescription>
                当前号码功能仍按原规则运行。第一次修改下方简化规则后，会用新的简化规则整体替换原规则。
              </AlertDescription>
            </Alert>
          ) : null}

          <Field>
            <FieldLabel htmlFor="bib-rule-preset">规则预设</FieldLabel>
            <FieldDescription>
              选择预设会立即填充规则，点击页面底部的保存按钮后正式生效。
            </FieldDescription>
            <Select
              items={[
                { label: "选择内置预设", value: null },
                { label: "5位年级班级号码（1–6）", value: "school-five-digit" },
              ]}
              onValueChange={applyRulePreset}
              value={rulePreset}
            >
              <SelectTrigger aria-label="号码规则预设" id="bib-rule-preset">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="school-five-digit">5位年级班级号码（1–6）</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>

          {rulePreset === "school-five-digit" ? (
            <div className="rounded-xl border bg-muted/20 p-4 text-sm">
              <p className="font-medium">5位年级班级号码（1–6）</p>
              <p className="mt-1 text-muted-foreground">
                5 位；第 1 位为 1–6；1–2 → 第 2–3 位 01–10；3 → 01–11；4 → 01–08；5–6 →
                01–06。
              </p>
            </div>
          ) : null}

          <Field>
            <FieldLabel htmlFor="bib-total-length">号码总位数</FieldLabel>
            <FieldDescription>所有合法号码都必须是这个长度，例如 5 位。</FieldDescription>
            <DraftNumberInput
              id="bib-total-length"
              max={12}
              min={1}
              onValueChange={(value) =>
                editRuleDraft((current) => ({ ...current, totalLength: value }))
              }
              value={ruleDraft.totalLength}
            />
          </Field>

          <div className="rounded-xl border bg-muted/20 p-4">
            <p className="text-sm font-medium">当前规则</p>
            <p className="mt-1 text-sm text-muted-foreground">{simpleRuleSummary(ruleDraft)}</p>
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold">基础限制</h3>
                <p className="text-xs text-muted-foreground">这些限制对所有号码始终生效。</p>
              </div>
              <Button
                disabled={ruleDraft.baseRules.length >= 12}
                onClick={() =>
                  editRuleDraft((current) => ({
                    ...current,
                    baseRules: [...current.baseRules, newSimpleConstraint()],
                  }))
                }
                size="sm"
                type="button"
                variant="outline"
              >
                <PlusIcon data-icon="inline-start" />
                添加基础限制
              </Button>
            </div>

            {ruleDraft.baseRules.length === 0 ? (
              <div
                className="rounded-lg border border-dashed px-4 py-5 text-center text-sm text-muted-foreground"
              >
                暂无基础限制。若第一位只能是 1–6，可在这里添加“第 1 位，1–6”。
              </div>
            ) : null}

            {ruleDraft.baseRules.map((rule, ruleIndex) => (
              <div
                className="grid gap-3 rounded-xl border p-3 md:grid-cols-[1fr_1fr_1fr_1fr_auto] md:items-end"
                key={rule.id}
              >
                <Field>
                  <FieldLabel htmlFor={`base-start-${ruleIndex}`}>从第几位开始</FieldLabel>
                  <DraftNumberInput
                    id={`base-start-${ruleIndex}`}
                    max={12}
                    min={1}
                    onValueChange={(value) =>
                      updateBaseRule(ruleIndex, (current) => ({
                        ...current,
                        startPosition: value,
                      }))
                    }
                    value={rule.startPosition}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor={`base-width-${ruleIndex}`}>连续读取几位</FieldLabel>
                  <DraftNumberInput
                    id={`base-width-${ruleIndex}`}
                    max={12}
                    min={1}
                    onValueChange={(value) =>
                      updateBaseRule(ruleIndex, (current) => resizeSimpleConstraint(current, value))
                    }
                    value={rule.width}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor={`base-range-start-${ruleIndex}`}>区间起点</FieldLabel>
                  <Input
                    id={`base-range-start-${ruleIndex}`}
                    inputMode="numeric"
                    onChange={(event) =>
                      updateBaseRule(ruleIndex, (current) => ({
                        ...current,
                        start: event.currentTarget.value,
                      }))
                    }
                    value={rule.start}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor={`base-range-end-${ruleIndex}`}>区间终点</FieldLabel>
                  <Input
                    id={`base-range-end-${ruleIndex}`}
                    inputMode="numeric"
                    onChange={(event) =>
                      updateBaseRule(ruleIndex, (current) => ({
                        ...current,
                        end: event.currentTarget.value,
                      }))
                    }
                    value={rule.end}
                  />
                </Field>
                <Button
                  aria-label={`删除基础限制 ${ruleIndex + 1}`}
                  onClick={() =>
                    editRuleDraft((current) => ({
                      ...current,
                      baseRules: current.baseRules.filter((_, index) => index !== ruleIndex),
                    }))
                  }
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <Trash2Icon />
                </Button>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold">条件限制</h3>
                <p className="text-xs text-muted-foreground">
                  例如：当第 1 位为 1–2 时，第 2–3 位必须为 01–10。添加条件限制后，号码必须至少满足其中一条。
                </p>
              </div>
              <Button
                disabled={ruleDraft.conditionalRules.length >= 20}
                onClick={() =>
                  editRuleDraft((current) => ({
                    ...current,
                    conditionalRules: [
                      ...current.conditionalRules,
                      {
                        id: crypto.randomUUID(),
                        when: newSimpleConstraint(),
                        then: newSimpleConstraint(2, 2),
                      },
                    ],
                  }))
                }
                size="sm"
                type="button"
                variant="outline"
              >
                <PlusIcon data-icon="inline-start" />
                添加条件限制
              </Button>
            </div>

            {ruleDraft.conditionalRules.length === 0 ? (
              <div
                className="rounded-lg border border-dashed px-4 py-5 text-center text-sm text-muted-foreground"
              >
                暂无条件限制。只有基础限制时，满足基础限制的号码即可通过。
              </div>
            ) : null}

            {ruleDraft.conditionalRules.map((rule, ruleIndex) => (
              <Card key={rule.id} size="sm">
                <CardHeader>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <CardTitle>条件 {ruleIndex + 1}</CardTitle>
                      <CardDescription>
                        当{simpleConstraintSummary(rule.when)}时，{simpleConstraintSummary(rule.then)}
                      </CardDescription>
                    </div>
                    <Button
                      aria-label={`删除条件限制 ${ruleIndex + 1}`}
                      onClick={() =>
                        editRuleDraft((current) => ({
                          ...current,
                          conditionalRules: current.conditionalRules.filter(
                            (_, index) => index !== ruleIndex,
                          ),
                        }))
                      }
                      size="icon"
                      type="button"
                      variant="ghost"
                    >
                      <Trash2Icon />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  {(["when", "then"] as const).map((side) => {
                    const segment = rule[side];
                    const prefix = side === "when" ? "当" : "则必须";
                    return (
                      <div className="flex flex-col gap-2" key={side}>
                        <p className="text-sm font-medium">{prefix}</p>
                        <FieldGroup className="md:grid md:grid-cols-4">
                          <Field>
                            <FieldLabel htmlFor={`conditional-${ruleIndex}-${side}-start`}>
                              从第几位开始
                            </FieldLabel>
                            <DraftNumberInput
                              id={`conditional-${ruleIndex}-${side}-start`}
                              max={12}
                              min={1}
                              onValueChange={(value) =>
                                updateConditionalRule(ruleIndex, side, (current) => ({
                                  ...current,
                                  startPosition: value,
                                }))
                              }
                              value={segment.startPosition}
                            />
                          </Field>
                          <Field>
                            <FieldLabel htmlFor={`conditional-${ruleIndex}-${side}-width`}>
                              连续读取几位
                            </FieldLabel>
                            <DraftNumberInput
                              id={`conditional-${ruleIndex}-${side}-width`}
                              max={12}
                              min={1}
                              onValueChange={(value) =>
                                updateConditionalRule(ruleIndex, side, (current) =>
                                  resizeSimpleConstraint(current, value),
                                )
                              }
                              value={segment.width}
                            />
                          </Field>
                          <Field>
                            <FieldLabel htmlFor={`conditional-${ruleIndex}-${side}-range-start`}>
                              区间起点
                            </FieldLabel>
                            <Input
                              id={`conditional-${ruleIndex}-${side}-range-start`}
                              inputMode="numeric"
                              onChange={(event) =>
                                updateConditionalRule(ruleIndex, side, (current) => ({
                                  ...current,
                                  start: event.currentTarget.value,
                                }))
                              }
                              value={segment.start}
                            />
                          </Field>
                          <Field>
                            <FieldLabel htmlFor={`conditional-${ruleIndex}-${side}-range-end`}>
                              区间终点
                            </FieldLabel>
                            <Input
                              id={`conditional-${ruleIndex}-${side}-range-end`}
                              inputMode="numeric"
                              onChange={(event) =>
                                updateConditionalRule(ruleIndex, side, (current) => ({
                                  ...current,
                                  end: event.currentTarget.value,
                                }))
                              }
                              value={segment.end}
                            />
                          </Field>
                        </FieldGroup>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>年级与班级</CardTitle>
          <CardDescription>
            先创建年级，再直接填写该年级的班级数量。系统会自动生成
            1班、2班……并把这些班级绑定到对应年级。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {orderedOptions(config.attributeOptions, "grade").length === 0 ? (
            <div className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
              暂无年级。添加年级后，可直接设置该年级包含多少个班。
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {orderedOptions(config.attributeOptions, "grade").map((grade, gradeIndex, grades) => {
                const gradeClasses = classesForGrade(config.attributeOptions, grade.id);
                const emptyName = grade.displayName.trim().length === 0;
                const duplicateName = grades.some(
                  (candidate) =>
                    candidate.id !== grade.id &&
                    candidate.displayName.trim().length > 0 &&
                    candidate.displayName.trim().localeCompare(grade.displayName.trim(), "zh-CN", {
                      sensitivity: "accent",
                    }) === 0,
                );
                const invalidName = emptyName || duplicateName;
                const allGradeClasses = allClassesForGrade(config.attributeOptions, grade.id);
                const maxClassCount = Math.max(
                  0,
                  Math.min(30, 100 - (config.attributeOptions.length - allGradeClasses.length)),
                );
                const linkedMappingCount = config.mappings.filter(
                  (mapping) =>
                    mapping.outputOptionId === grade.id ||
                    gradeClasses.some((classOption) => classOption.id === mapping.outputOptionId),
                ).length;

                return (
                  <Card key={grade.id} size="sm">
                    <CardHeader className="gap-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <CardTitle>{optionLabel(grade)}</CardTitle>
                          <CardDescription>
                            {gradeClasses.length} 个班
                            {linkedMappingCount > 0 ? ` · ${linkedMappingCount} 条号码映射` : ""}
                          </CardDescription>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            aria-label={`上移${optionLabel(grade)}`}
                            disabled={gradeIndex === 0}
                            onClick={() => moveOption(grade.id, -1)}
                            size="icon-sm"
                            type="button"
                            variant="ghost"
                          >
                            <ArrowUpIcon />
                          </Button>
                          <Button
                            aria-label={`下移${optionLabel(grade)}`}
                            disabled={gradeIndex === grades.length - 1}
                            onClick={() => moveOption(grade.id, 1)}
                            size="icon-sm"
                            type="button"
                            variant="ghost"
                          >
                            <ArrowDownIcon />
                          </Button>
                          <Button
                            aria-label={`删除${optionLabel(grade)}及其班级`}
                            onClick={() => removeOption(grade.id)}
                            size="icon-sm"
                            type="button"
                            variant="ghost"
                          >
                            <Trash2Icon />
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-4">
                      <FieldGroup className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem_auto] sm:items-end">
                        <Field data-invalid={invalidName || undefined}>
                          <FieldLabel htmlFor={`bib-grade-${grade.id}`}>年级名称</FieldLabel>
                          <Input
                            aria-invalid={invalidName || undefined}
                            id={`bib-grade-${grade.id}`}
                            maxLength={60}
                            onChange={(event) => {
                              const { value } = event.currentTarget;
                              updateOption(grade.id, (current) => ({
                                ...current,
                                displayName: value,
                              }));
                            }}
                            value={grade.displayName}
                          />
                          {invalidName ? (
                            <FieldDescription>
                              {emptyName ? "名称不能为空" : "年级名称不能重复"}
                            </FieldDescription>
                          ) : null}
                        </Field>
                        <Field>
                          <FieldLabel htmlFor={`bib-grade-class-count-${grade.id}`}>
                            班级数量
                          </FieldLabel>
                          <DraftNumberInput
                            id={`bib-grade-class-count-${grade.id}`}
                            max={maxClassCount}
                            min={0}
                            onValueChange={(value) => setGradeClassCount(grade.id, value)}
                            value={gradeClasses.length}
                          />
                        </Field>
                        <Field className="flex-row items-center gap-2 pb-2">
                          <FieldLabel className="text-xs" htmlFor={`bib-grade-enabled-${grade.id}`}>
                            {grade.enabled ? "启用" : "停用"}
                          </FieldLabel>
                          <Switch
                            checked={grade.enabled}
                            id={`bib-grade-enabled-${grade.id}`}
                            onCheckedChange={(checked) => setGradeEnabled(grade.id, checked)}
                          />
                        </Field>
                      </FieldGroup>

                      <div className="rounded-xl bg-muted/35 p-3">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <span className="text-xs font-medium">自动派生班级</span>
                          <span className="text-xs text-muted-foreground">
                            调整数量会自动增删末尾班级
                          </span>
                        </div>
                        {gradeClasses.length === 0 ? (
                          <p className="text-xs text-muted-foreground">当前未设置班级。</p>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {gradeClasses.map((classOption) => (
                              <Badge key={classOption.id} variant="outline">
                                {optionLabel(classOption)}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          <Button
            disabled={config.attributeOptions.length >= 100}
            onClick={addGrade}
            type="button"
            variant="outline"
          >
            <PlusIcon data-icon="inline-start" />
            添加年级
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>号码到年级/班级的映射</CardTitle>
          <CardDescription>
            指定号码中的哪几位对应哪个年级或班级。同一合法号码不能映射到同一类别的两个不同选项。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="bib-mapping-preset">映射预设</FieldLabel>
            <FieldDescription>
              选择预设会整体替换当前号码映射；年级与班级选项本身不会被修改。
            </FieldDescription>
            <Select
              items={[
                { label: "选择内置预设", value: null },
                {
                  label: "1–6 → 初一～高三，01–11 → 班级",
                  value: "school-grade-class",
                },
              ]}
              onValueChange={applyMappingPreset}
              value={mappingPreset}
            >
              <SelectTrigger aria-label="号码映射预设" id="bib-mapping-preset">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="school-grade-class">
                    1–6 → 初一～高三，01–11 → 班级
                  </SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>

          {mappingPreset === "school-grade-class" ? (
            <div className="rounded-xl border bg-muted/20 p-4 text-sm">
              <p className="font-medium">初一～高三号码映射</p>
              <p className="mt-1 text-muted-foreground">
                第 1 位 1–6 依次映射到初一、初二、初三、高一、高二、高三；第 2–3 位按每个年级当前已有班级生成 01 → 1班、02 → 2班……，最多到 11班。某年级少于 11
                个班时，会自动截止到该年级当前最大班号。
              </p>
            </div>
          ) : null}

          {config.mappings.length === 0 ? (
            <div className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
              尚未设置号码映射。添加后，系统可以根据号码中的指定位置自动派生年级或班级。
            </div>
          ) : null}
          {config.mappings.map((mapping, mappingIndex) => {
            const optionItems = orderedOptions(config.attributeOptions, mapping.dimension)
              .filter((option) => option.enabled)
              .map((option) => ({
                value: option.id,
                label: mappingOptionLabel(option, config.attributeOptions),
              }));
            return (
              <Card
                key={
                  mapping.id ??
                  `${mapping.dimension}-${mapping.outputOptionId}-${mapping.sortOrder}`
                }
                size="sm"
              >
                <CardHeader>
                  <CardTitle>
                    {dimensionLabel(mapping.dimension)}映射 ·{" "}
                    {optionLabel(
                      config.attributeOptions.find(
                        (option) => option.id === mapping.outputOptionId,
                      ) ?? {
                        id: mapping.outputOptionId,
                        dimension: mapping.dimension,
                        displayName: "",
                        sortOrder: 0,
                        enabled: false,
                        parentGradeOptionId: null,
                      },
                    )}
                  </CardTitle>
                  <CardDescription>
                    读取第 {mapping.startPosition}–{mapping.startPosition + mapping.width - 1} 位
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <FieldGroup className="md:grid md:grid-cols-3">
                    <Field>
                      <FieldLabel htmlFor={`mapping-start-${mappingIndex}`}>起始位置</FieldLabel>
                      <DraftNumberInput
                        id={`mapping-start-${mappingIndex}`}
                        max={12}
                        min={1}
                        onValueChange={(value) =>
                          updateMapping(mappingIndex, (current) => ({
                            ...current,
                            startPosition: value,
                          }))
                        }
                        value={mapping.startPosition}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor={`mapping-width-${mappingIndex}`}>宽度</FieldLabel>
                      <DraftNumberInput
                        id={`mapping-width-${mappingIndex}`}
                        max={12}
                        min={1}
                        onValueChange={(value) =>
                          updateMapping(mappingIndex, (current) => ({
                            ...current,
                            width: value,
                          }))
                        }
                        value={mapping.width}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor={`mapping-output-${mappingIndex}`}>
                        对应{dimensionLabel(mapping.dimension)}
                      </FieldLabel>
                      <Select
                        items={optionItems}
                        onValueChange={(value) => {
                          if (typeof value === "string") {
                            updateMapping(mappingIndex, (current) => ({
                              ...current,
                              outputOptionId: value,
                            }));
                          }
                        }}
                        value={mapping.outputOptionId}
                      >
                        <SelectTrigger id={`mapping-output-${mappingIndex}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {optionItems.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Field>
                  </FieldGroup>
                  {mapping.ranges.map((range, rangeIndex) => (
                    <FieldGroup
                      className="grid grid-cols-[1fr_1fr_auto] items-end gap-2"
                      key={range.id ?? `${range.start}-${range.end}`}
                    >
                      <Field>
                        <FieldLabel htmlFor={`mapping-range-start-${mappingIndex}-${rangeIndex}`}>
                          区间起点
                        </FieldLabel>
                        <Input
                          id={`mapping-range-start-${mappingIndex}-${rangeIndex}`}
                          inputMode="numeric"
                          onChange={(event) => {
                            const { value } = event.currentTarget;
                            updateMapping(mappingIndex, (current) => ({
                              ...current,
                              ranges: current.ranges.map((currentRange, index) =>
                                index === rangeIndex
                                  ? { ...currentRange, start: value }
                                  : currentRange,
                              ),
                            }));
                          }}
                          value={range.start}
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor={`mapping-range-end-${mappingIndex}-${rangeIndex}`}>
                          区间终点
                        </FieldLabel>
                        <Input
                          id={`mapping-range-end-${mappingIndex}-${rangeIndex}`}
                          inputMode="numeric"
                          onChange={(event) => {
                            const { value } = event.currentTarget;
                            updateMapping(mappingIndex, (current) => ({
                              ...current,
                              ranges: current.ranges.map((currentRange, index) =>
                                index === rangeIndex
                                  ? { ...currentRange, end: value }
                                  : currentRange,
                              ),
                            }));
                          }}
                          value={range.end}
                        />
                      </Field>
                      <Button
                        aria-label={`删除映射 ${mappingIndex + 1} 区间 ${rangeIndex + 1}`}
                        onClick={() =>
                          updateMapping(mappingIndex, (current) => ({
                            ...current,
                            ranges: current.ranges.filter((_, index) => index !== rangeIndex),
                          }))
                        }
                        size="icon"
                        type="button"
                        variant="ghost"
                      >
                        <Trash2Icon />
                      </Button>
                    </FieldGroup>
                  ))}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={() =>
                        updateMapping(mappingIndex, (current) => ({
                          ...current,
                          ranges: [
                            ...current.ranges,
                            {
                              id: crypto.randomUUID(),
                              start: "0".repeat(Math.max(1, current.width)),
                              end: "9".repeat(Math.max(1, current.width)),
                            },
                          ],
                        }))
                      }
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      添加区间
                    </Button>
                    <Button
                      onClick={() => {
                        setMappingPreset(null);
                        setConfig((current) => ({
                          ...current,
                          mappings: current.mappings.filter((_, index) => index !== mappingIndex),
                        }));
                      }}
                      size="sm"
                      type="button"
                      variant="destructive"
                    >
                      删除映射
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => addMapping("grade")} type="button" variant="outline">
              <PlusIcon data-icon="inline-start" />
              添加年级映射
            </Button>
            <Button onClick={() => addMapping("class")} type="button" variant="outline">
              <PlusIcon data-icon="inline-start" />
              添加班级映射
            </Button>
          </div>
        </CardContent>
      </Card>

      {validation.issues.length === 0 ? (
        <Alert>
          <AlertTitle>本地规则检查通过</AlertTitle>
          <AlertDescription>保存时服务器会使用同一规则再次验证并建立版本。</AlertDescription>
        </Alert>
      ) : (
        <Alert variant="destructive">
          <AlertTitle>发现 {validation.issues.length} 项规则问题</AlertTitle>
          <AlertDescription>
            {validation.issues.map((issue) => `${issue.path}：${issue.message}`).join("；")}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>测试号码</CardTitle>
          <CardDescription>显示合法性和当前年级/班级派生，不保存测试值。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Field data-invalid={testNumberInvalid || undefined}>
            <FieldLabel htmlFor="bib-test-number">测试号码</FieldLabel>
            <Input
              aria-invalid={testNumberInvalid || undefined}
              id="bib-test-number"
              inputMode="numeric"
              maxLength={12}
              onChange={(event) => {
                const { value } = event.currentTarget;
                setTestNumber(value);
              }}
              value={testNumber}
            />
          </Field>
          {testNumber.length > 0 && localTestResult === null ? (
            <Alert variant="destructive">
              <AlertTitle>请输入 1–12 位数字</AlertTitle>
              <AlertDescription>
                允许全角数字和数字间空白；不会把字母自动替换为数字。
              </AlertDescription>
            </Alert>
          ) : null}
          {localTestResult === null ? null : (
            <Alert variant={localTestResult.valid ? "default" : "destructive"}>
              <AlertTitle>
                当前编辑内容：{localTestResult.valid ? "号码合法" : "号码不符合规则"}
              </AlertTitle>
              <AlertDescription>
                <div className="flex flex-col gap-2">
                  <p>
                    规范化号码：{localTestResult.normalizedNumber}；年级：
                    {config.attributeOptions.find(
                      (option) => option.id === localTestResult.gradeOptionId,
                    )?.displayName ?? "未映射"}
                    ；班级：
                    {config.attributeOptions.find(
                      (option) => option.id === localTestResult.classOptionId,
                    )?.displayName ?? "未映射"}
                  </p>
                  <ul className="flex list-disc flex-col gap-1 pl-5">
                    {localTestResult.patterns.map((pattern) => (
                      <li key={`local-test-pattern-${pattern.patternIndex}`}>
                        分支 {pattern.patternIndex + 1}：
                        {pattern.lengthMatched ? "位数符合" : "位数不符"}，
                        {pattern.matched ? "全部条件满足" : "未通过"}
                        {pattern.constraints.length === 0 ? null : (
                          <ul className="list-disc pl-5">
                            {pattern.constraints.map((constraint) => (
                              <li
                                key={`local-test-pattern-${pattern.patternIndex}-constraint-${constraint.constraintIndex}`}
                              >
                                第 {constraint.startPosition}–
                                {constraint.startPosition + constraint.width - 1} 位值“
                                {constraint.value || "空"}”：
                                {constraint.matched ? "通过" : "不通过"}
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              </AlertDescription>
            </Alert>
          )}
          <Button
            disabled={pending || testNumber.length === 0}
            onClick={() => void test()}
            type="button"
            variant="outline"
          >
            <FlaskConicalIcon data-icon="inline-start" />
            对照服务器已保存版本
          </Button>
          {testResult === null ? null : (
            <Alert variant={testResult.valid ? "default" : "destructive"}>
              <AlertTitle>
                服务器已保存版本：{testResult.valid ? "号码合法" : "号码不符合规则"}
              </AlertTitle>
              <AlertDescription>
                年级：
                {saved.attributeOptions.find((option) => option.id === testResult.gradeOptionId)
                  ?.displayName ?? "未映射"}
                ；班级：
                {saved.attributeOptions.find((option) => option.id === testResult.classOptionId)
                  ?.displayName ?? "未映射"}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Button disabled={pending} onClick={() => void save()} type="button">
        <SaveIcon data-icon="inline-start" />
        {pending ? "正在保存…" : "保存号码规则与映射"}
      </Button>
      <ErrorDialog message={error} onClose={() => setError(null)} title="号码配置失败" />
    </div>
  );
}
