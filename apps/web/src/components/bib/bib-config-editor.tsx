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
import { ArrowDownIcon, ArrowUpIcon, FlaskConicalIcon, PlusIcon, SaveIcon, Trash2Icon } from "lucide-react";
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

function newConstraint(): BibConstraintInput {
  return {
    id: crypto.randomUUID(),
    startPosition: 1,
    width: 1,
    ranges: [{ id: crypto.randomUUID(), start: "0", end: "9" }],
    sortOrder: 0,
  };
}

function newPattern(): BibPatternInput {
  return {
    id: crypto.randomUUID(),
    totalLength: 6,
    sortOrder: 0,
    enabled: true,
    constraints: [],
  };
}

function requestFrom(config: BibConfigView): BibConfigUpdate {
  return {
    recognitionEnabled: config.recognitionEnabled,
    searchEnabled: config.searchEnabled,
    modelVersion: config.modelVersion,
    patterns: config.patterns,
    attributeOptions: config.attributeOptions,
    mappings: config.mappings,
  };
}

function digitCoverage(
  pattern: BibPatternInput,
): readonly { readonly position: number; readonly constrained: boolean }[] {
  return Array.from({ length: pattern.totalLength }, (_, index) => ({
    position: index + 1,
    constrained: pattern.constraints.some(
      (constraint) =>
        index + 1 >= constraint.startPosition &&
        index + 1 < constraint.startPosition + constraint.width,
    ),
  }));
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

function classesForGrade(
  options: readonly BibAttributeOptionInput[],
  gradeOptionId: string,
): BibAttributeOptionInput[] {
  return orderedOptions(options, "class").filter(
    (option) => option.parentGradeOptionId === gradeOptionId,
  );
}

function mappingOptionLabel(
  option: BibAttributeOptionInput,
  options: readonly BibAttributeOptionInput[],
): string {
  if (option.dimension !== "class" || option.parentGradeOptionId == null) {
    return optionLabel(option);
  }
  const grade = options.find(
    (candidate) => candidate.id === option.parentGradeOptionId && candidate.dimension === "grade",
  );
  return grade === undefined ? optionLabel(option) : `${optionLabel(grade)} · ${optionLabel(option)}`;
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
  const [saved, setSaved] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testNumber, setTestNumber] = useState("");
  const [testResult, setTestResult] = useState<BibTestResponse | null>(null);
  const validation = useMemo(() => {
    const rule = validateBibRuleSet(config.patterns);
    const mapping = validateBibMappings(config.patterns, config.attributeOptions, config.mappings);
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
      if (
        option.dimension === "grade" &&
        parentGradeOptionId !== null
      ) {
        return [
          {
            code: "INVALID_ATTRIBUTE_HIERARCHY",
            path: `attributeOptions.${index}.parentGradeOptionId`,
            message: "年级不能隶属于其他年级",
          },
        ];
      }
      if (
        option.dimension === "class" &&
        parentGradeOptionId !== null &&
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
                option.dimension === "grade"
                  ? "年级名称不能重复"
                  : "同一年级下班级名称不能重复",
            },
          ];
    });
    return { rule, mapping, issues: [...rule.issues, ...mapping.issues, ...optionIssues] };
  }, [config]);
  const localTestResult = useMemo(() => {
    const normalizedNumber = normalizeBibNumber(testNumber);
    if (normalizedNumber === null) return null;
    const evaluation = evaluateBibNumber(normalizedNumber, config.patterns);
    const derived = evaluation.valid
      ? deriveBibAttributes(normalizedNumber, config.mappings)
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
  }, [config, testNumber]);
  const testNumberInvalid = testNumber.length > 0 && localTestResult === null;

  function updatePattern(
    patternIndex: number,
    update: (pattern: BibPatternInput) => BibPatternInput,
  ) {
    setConfig((current) => ({
      ...current,
      patterns: current.patterns.map((pattern, index) =>
        index === patternIndex ? update(pattern) : pattern,
      ),
    }));
  }

  function updateConstraint(
    patternIndex: number,
    constraintIndex: number,
    update: (constraint: BibConstraintInput) => BibConstraintInput,
  ) {
    updatePattern(patternIndex, (pattern) => ({
      ...pattern,
      constraints: pattern.constraints.map((constraint, index) =>
        index === constraintIndex ? update(constraint) : constraint,
      ),
    }));
  }

  function updateOption(
    optionId: string,
    update: (option: BibAttributeOptionInput) => BibAttributeOptionInput,
  ) {
    setConfig((current) => ({
      ...current,
      attributeOptions: current.attributeOptions.map((option) =>
        option.id === optionId ? update(option) : option,
      ),
    }));
  }

  function moveOption(optionId: string, direction: -1 | 1): void {
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
    setConfig((current) => ({
      ...current,
      mappings: current.mappings.map((mapping, index) =>
        index === mappingIndex ? update(mapping) : mapping,
      ),
    }));
  }

  function addGrade(): void {
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
    setConfig((current) => {
      const grade = current.attributeOptions.find(
        (option) => option.id === gradeOptionId && option.dimension === "grade",
      );
      if (grade === undefined) return current;
      const existing = classesForGrade(current.attributeOptions, gradeOptionId);
      const otherOptionCount = current.attributeOptions.length - existing.length;
      const classCount = Math.max(0, Math.min(requestedCount, 30, 100 - otherOptionCount));
      const nextClasses = Array.from({ length: classCount }, (_, index) => {
        const currentClass = existing[index];
        return {
          id: currentClass?.id ?? crypto.randomUUID(),
          dimension: "class" as const,
          displayName: `${index + 1}班`,
          sortOrder: index,
          enabled: grade.enabled,
          parentGradeOptionId: gradeOptionId,
        };
      });
      const removedIds = new Set(existing.slice(classCount).map((option) => option.id));
      return {
        ...current,
        attributeOptions: [
          ...current.attributeOptions.filter(
            (option) =>
              !(
                option.dimension === "class" &&
                option.parentGradeOptionId === gradeOptionId
              ),
          ),
          ...nextClasses,
        ],
        mappings: current.mappings.filter((mapping) => !removedIds.has(mapping.outputOptionId)),
      };
    });
  }

  function setGradeEnabled(gradeOptionId: string, enabled: boolean): void {
    setConfig((current) => ({
      ...current,
      attributeOptions: current.attributeOptions.map((option) =>
        option.id === gradeOptionId || option.parentGradeOptionId === gradeOptionId
          ? { ...option, enabled }
          : option,
      ),
    }));
  }

  function assignLegacyClass(classOptionId: string, gradeOptionId: string): void {
    setConfig((current) => {
      const siblings = classesForGrade(current.attributeOptions, gradeOptionId);
      return {
        ...current,
        attributeOptions: current.attributeOptions.map((option) =>
          option.id === classOptionId
            ? {
                ...option,
                parentGradeOptionId: gradeOptionId,
                sortOrder: siblings.length,
              }
            : option,
        ),
      };
    });
  }

  function addMapping(dimension: BibAttributeDimension): void {
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
        { method: "PUT", body: config },
      );
      setSaved(updated);
      setConfig(requestFrom(updated));
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
          <CardTitle>号码模式</CardTitle>
          <CardDescription>模式之间为 OR；同一模式内约束为 AND，位置从 1 开始。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {config.patterns.map((pattern, patternIndex) => {
            const coverage = digitCoverage(pattern);
            return (
              <Card key={pattern.id ?? `${pattern.totalLength}-${pattern.sortOrder}`} size="sm">
                <CardHeader>
                  <CardTitle>模式 {patternIndex + 1}</CardTitle>
                  <CardDescription>
                    <span className="flex flex-wrap gap-1">
                      <span className="sr-only">号码位预览</span>
                      {coverage.map(({ constrained, position }) => (
                        <Badge
                          key={`${pattern.id ?? pattern.totalLength}-digit-${position}`}
                          variant={constrained ? "secondary" : "outline"}
                        >
                          {position}：{constrained ? "约束" : "任意"}
                        </Badge>
                      ))}
                    </span>
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <FieldGroup className="md:grid md:grid-cols-3">
                    <Field>
                      <FieldLabel htmlFor={`pattern-length-${patternIndex}`}>总位数</FieldLabel>
                      <DraftNumberInput
                        id={`pattern-length-${patternIndex}`}
                        max={12}
                        min={1}
                        onValueChange={(value) =>
                          updatePattern(patternIndex, (current) => ({
                            ...current,
                            totalLength: value,
                          }))
                        }
                        value={pattern.totalLength}
                      />
                    </Field>
                    <Field orientation="horizontal">
                      <FieldLabel htmlFor={`pattern-enabled-${patternIndex}`}>启用模式</FieldLabel>
                      <Switch
                        checked={pattern.enabled}
                        id={`pattern-enabled-${patternIndex}`}
                        onCheckedChange={(checked) =>
                          updatePattern(patternIndex, (current) => ({
                            ...current,
                            enabled: checked,
                          }))
                        }
                      />
                    </Field>
                    <Button
                      onClick={() =>
                        setConfig((current) => ({
                          ...current,
                          patterns: current.patterns.filter((_, index) => index !== patternIndex),
                        }))
                      }
                      type="button"
                      variant="destructive"
                    >
                      <Trash2Icon data-icon="inline-start" />
                      删除模式
                    </Button>
                  </FieldGroup>

                  {pattern.constraints.map((constraint, constraintIndex) => (
                    <Card
                      key={constraint.id ?? `${constraint.startPosition}-${constraint.width}`}
                      size="sm"
                    >
                      <CardHeader>
                        <CardTitle>约束 {constraintIndex + 1}</CardTitle>
                        <CardDescription>区间端点必须保持与宽度相同的位数。</CardDescription>
                      </CardHeader>
                      <CardContent className="flex flex-col gap-3">
                        <FieldGroup className="md:grid md:grid-cols-3">
                          <Field>
                            <FieldLabel
                              htmlFor={`constraint-start-${patternIndex}-${constraintIndex}`}
                            >
                              起始位置
                            </FieldLabel>
                            <DraftNumberInput
                              id={`constraint-start-${patternIndex}-${constraintIndex}`}
                              max={12}
                              min={1}
                              onValueChange={(value) =>
                                updateConstraint(patternIndex, constraintIndex, (current) => ({
                                  ...current,
                                  startPosition: value,
                                }))
                              }
                              value={constraint.startPosition}
                            />
                          </Field>
                          <Field>
                            <FieldLabel
                              htmlFor={`constraint-width-${patternIndex}-${constraintIndex}`}
                            >
                              连续宽度
                            </FieldLabel>
                            <DraftNumberInput
                              id={`constraint-width-${patternIndex}-${constraintIndex}`}
                              max={12}
                              min={1}
                              onValueChange={(value) =>
                                updateConstraint(patternIndex, constraintIndex, (current) => ({
                                  ...current,
                                  width: value,
                                }))
                              }
                              value={constraint.width}
                            />
                          </Field>
                          <Button
                            onClick={() =>
                              updatePattern(patternIndex, (current) => ({
                                ...current,
                                constraints: current.constraints.filter(
                                  (_, index) => index !== constraintIndex,
                                ),
                              }))
                            }
                            type="button"
                            variant="outline"
                          >
                            删除约束
                          </Button>
                        </FieldGroup>
                        {constraint.ranges.map((range, rangeIndex) => (
                          <FieldGroup
                            className="grid grid-cols-[1fr_1fr_auto] items-end gap-2"
                            key={range.id ?? `${range.start}-${range.end}`}
                          >
                            <Field>
                              <FieldLabel
                                htmlFor={`range-start-${patternIndex}-${constraintIndex}-${rangeIndex}`}
                              >
                                区间起点
                              </FieldLabel>
                              <Input
                                id={`range-start-${patternIndex}-${constraintIndex}-${rangeIndex}`}
                                inputMode="numeric"
                                onChange={(event) => {
                                  const { value } = event.currentTarget;
                                  updateConstraint(patternIndex, constraintIndex, (current) => ({
                                    ...current,
                                    ranges: current.ranges.map((currentRange, index) =>
                                      index === rangeIndex ? { ...currentRange, start: value } : currentRange,
                                    ),
                                  }));
                                }}
                                value={range.start}
                              />
                            </Field>
                            <Field>
                              <FieldLabel
                                htmlFor={`range-end-${patternIndex}-${constraintIndex}-${rangeIndex}`}
                              >
                                区间终点
                              </FieldLabel>
                              <Input
                                id={`range-end-${patternIndex}-${constraintIndex}-${rangeIndex}`}
                                inputMode="numeric"
                                onChange={(event) => {
                                  const { value } = event.currentTarget;
                                  updateConstraint(patternIndex, constraintIndex, (current) => ({
                                    ...current,
                                    ranges: current.ranges.map((currentRange, index) =>
                                      index === rangeIndex ? { ...currentRange, end: value } : currentRange,
                                    ),
                                  }));
                                }}
                                value={range.end}
                              />
                            </Field>
                            <Button
                              aria-label={`删除模式 ${patternIndex + 1} 约束 ${constraintIndex + 1} 区间 ${rangeIndex + 1}`}
                              onClick={() =>
                                updateConstraint(patternIndex, constraintIndex, (current) => ({
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
                        <Button
                          onClick={() =>
                            updateConstraint(patternIndex, constraintIndex, (current) => ({
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
                          <PlusIcon data-icon="inline-start" />
                          添加区间
                        </Button>
                      </CardContent>
                    </Card>
                  ))}
                  <Button
                    onClick={() =>
                      updatePattern(patternIndex, (current) => ({
                        ...current,
                        constraints: [...current.constraints, newConstraint()],
                      }))
                    }
                    type="button"
                    variant="outline"
                  >
                    <PlusIcon data-icon="inline-start" />
                    添加 AND 约束
                  </Button>
                </CardContent>
              </Card>
            );
          })}
          <Button
            onClick={() =>
              setConfig((current) => ({
                ...current,
                patterns: [...current.patterns, newPattern()],
              }))
            }
            type="button"
            variant="outline"
          >
            <PlusIcon data-icon="inline-start" />
            添加 OR 模式
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>年级与班级</CardTitle>
          <CardDescription>
            先创建年级，再直接填写该年级的班级数量。系统会自动生成 1班、2班……并把这些班级绑定到对应年级。
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
                const maxClassCount = Math.max(
                  0,
                  Math.min(30, 100 - (config.attributeOptions.length - gradeClasses.length)),
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

          <Button onClick={addGrade} type="button" variant="outline">
            <PlusIcon data-icon="inline-start" />
            添加年级
          </Button>

          {orderedOptions(config.attributeOptions, "class").some(
            (option) => option.parentGradeOptionId == null,
          ) ? (
            <div className="rounded-xl border border-dashed p-4">
              <div className="mb-3">
                <p className="text-sm font-medium">旧版通用班级</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  这些班级来自旧配置，尚未归属具体年级。可选择归属年级完成迁移；迁移前仍按旧逻辑对所有年级可用。
                </p>
              </div>
              <div className="flex flex-col gap-2">
                {orderedOptions(config.attributeOptions, "class")
                  .filter((option) => option.parentGradeOptionId == null)
                  .map((classOption) => {
                    const gradeItems = orderedOptions(config.attributeOptions, "grade").map(
                      (grade) => ({ value: grade.id, label: optionLabel(grade) }),
                    );
                    return (
                      <div
                        className="grid gap-2 rounded-lg border bg-background p-3 sm:grid-cols-[minmax(0,1fr)_12rem_auto] sm:items-end"
                        key={classOption.id}
                      >
                        <div>
                          <p className="text-sm font-medium">{optionLabel(classOption)}</p>
                          <p className="text-xs text-muted-foreground">未归属年级</p>
                        </div>
                        <Field>
                          <FieldLabel>归属年级</FieldLabel>
                          <Select
                            items={gradeItems}
                            onValueChange={(value) => {
                              if (typeof value === "string") {
                                assignLegacyClass(classOption.id, value);
                              }
                            }}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="选择年级" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectGroup>
                                {gradeItems.map((grade) => (
                                  <SelectItem key={grade.value} value={grade.value}>
                                    {grade.label}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                        </Field>
                        <Button
                          aria-label={`删除旧版班级${optionLabel(classOption)}`}
                          onClick={() => removeOption(classOption.id)}
                          size="icon-sm"
                          type="button"
                          variant="ghost"
                        >
                          <Trash2Icon />
                        </Button>
                      </div>
                    );
                  })}
              </div>
            </div>
          ) : null}
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
                    读取第 {mapping.startPosition}–
                    {mapping.startPosition + mapping.width - 1} 位
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
                                index === rangeIndex ? { ...currentRange, start: value } : currentRange,
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
                                index === rangeIndex ? { ...currentRange, end: value } : currentRange,
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
                      onClick={() =>
                        setConfig((current) => ({
                          ...current,
                          mappings: current.mappings.filter((_, index) => index !== mappingIndex),
                        }))
                      }
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
                        模式 {pattern.patternIndex + 1}：
                        {pattern.lengthMatched ? "位数符合" : "位数不符"}，
                        {pattern.matched ? "全部约束通过" : "未通过"}
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
