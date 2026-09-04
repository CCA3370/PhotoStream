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
import { FlaskConicalIcon, PlusIcon, SaveIcon, Trash2Icon } from "lucide-react";
import { useMemo, useState } from "react";

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
    return { rule, mapping, issues: [...rule.issues, ...mapping.issues] };
  }, [config]);
  const localTestResult = useMemo(() => {
    const normalizedNumber = normalizeBibNumber(testNumber);
    if (normalizedNumber === null) return null;
    const evaluation = evaluateBibNumber(normalizedNumber, config.patterns);
    const attributes = evaluation.valid
      ? deriveBibAttributes(normalizedNumber, config.mappings)
      : { gradeOptionId: null, classOptionId: null, matchedMappingIds: [] };
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
    optionIndex: number,
    update: (option: BibAttributeOptionInput) => BibAttributeOptionInput,
  ) {
    setConfig((current) => ({
      ...current,
      attributeOptions: current.attributeOptions.map((option, index) =>
        index === optionIndex ? update(option) : option,
      ),
    }));
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

  function addOption(dimension: BibAttributeDimension): void {
    setConfig((current) => ({
      ...current,
      attributeOptions: [
        ...current.attributeOptions,
        {
          id: crypto.randomUUID(),
          dimension,
          displayName: dimension === "grade" ? "新年级" : "新班级",
          sortOrder: current.attributeOptions.filter((option) => option.dimension === dimension)
            .length,
          enabled: true,
        },
      ],
    }));
  }

  function addMapping(dimension: BibAttributeDimension): void {
    const output = config.attributeOptions.find(
      (option) => option.dimension === dimension && option.enabled,
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
      <Alert>
        <AlertTitle>
          规则版本 {saved.ruleVersion} · 映射版本 {saved.mappingVersion}
        </AlertTitle>
        <AlertDescription>
          自动识别只产生候选；只有人工确认号码才进入口令相册精确搜索。当前重算状态：
          {saved.recalculationStatus}。
        </AlertDescription>
      </Alert>
      {saved.automationStatus === "qualified" ? null : (
        <Alert variant={saved.automationStatus === "disabled" ? "destructive" : "default"}>
          <AlertTitle>
            自动候选状态：{saved.automationStatus === "disabled" ? "已禁用" : "实验性"}
          </AlertTitle>
          <AlertDescription>
            {saved.automationStatus === "disabled"
              ? "当前环境禁止启动本地 OCR；手工补录与已启用的精确搜索仍可使用。"
              : "尚未完成 200 张授权样本、移动端与 Safari/WASM 门禁；候选必须人工确认，不能视为正式识别能力。"}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>功能开关与模型</CardTitle>
          <CardDescription>搜索只能用于口令相册；模型固定从站内哈希资源路径加载。</CardDescription>
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
            <Field>
              <FieldLabel htmlFor="bib-model-version">固定模型版本</FieldLabel>
              <Input id="bib-model-version" readOnly value={config.modelVersion} />
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
                      <Input
                        id={`pattern-length-${patternIndex}`}
                        max={12}
                        min={1}
                        onChange={(event) =>
                          updatePattern(patternIndex, (current) => ({
                            ...current,
                            totalLength: Number(event.currentTarget.value),
                          }))
                        }
                        type="number"
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
                            <Input
                              id={`constraint-start-${patternIndex}-${constraintIndex}`}
                              max={12}
                              min={1}
                              onChange={(event) =>
                                updateConstraint(patternIndex, constraintIndex, (current) => ({
                                  ...current,
                                  startPosition: Number(event.currentTarget.value),
                                }))
                              }
                              type="number"
                              value={constraint.startPosition}
                            />
                          </Field>
                          <Field>
                            <FieldLabel
                              htmlFor={`constraint-width-${patternIndex}-${constraintIndex}`}
                            >
                              连续宽度
                            </FieldLabel>
                            <Input
                              id={`constraint-width-${patternIndex}-${constraintIndex}`}
                              max={12}
                              min={1}
                              onChange={(event) =>
                                updateConstraint(patternIndex, constraintIndex, (current) => ({
                                  ...current,
                                  width: Number(event.currentTarget.value),
                                }))
                              }
                              type="number"
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
                                onChange={(event) =>
                                  updateConstraint(patternIndex, constraintIndex, (current) => ({
                                    ...current,
                                    ranges: current.ranges.map((currentRange, index) =>
                                      index === rangeIndex
                                        ? { ...currentRange, start: event.currentTarget.value }
                                        : currentRange,
                                    ),
                                  }))
                                }
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
                                onChange={(event) =>
                                  updateConstraint(patternIndex, constraintIndex, (current) => ({
                                    ...current,
                                    ranges: current.ranges.map((currentRange, index) =>
                                      index === rangeIndex
                                        ? { ...currentRange, end: event.currentTarget.value }
                                        : currentRange,
                                    ),
                                  }))
                                }
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
          <CardTitle>年级与班级选项</CardTitle>
          <CardDescription>只保存类别，不导入姓名、学号或号码到个人身份映射。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {config.attributeOptions.map((option, optionIndex) => (
            <FieldGroup
              className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[minmax(0,1fr)_6rem_auto_auto]"
              key={option.id}
            >
              <Field>
                <FieldLabel htmlFor={`bib-option-${option.id}`}>
                  {option.dimension === "grade" ? "年级名称" : "班级名称"}
                </FieldLabel>
                <Input
                  id={`bib-option-${option.id}`}
                  onChange={(event) =>
                    updateOption(optionIndex, (current) => ({
                      ...current,
                      displayName: event.currentTarget.value,
                    }))
                  }
                  value={option.displayName}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`bib-option-sort-${option.id}`}>排序</FieldLabel>
                <Input
                  id={`bib-option-sort-${option.id}`}
                  min={0}
                  onChange={(event) =>
                    updateOption(optionIndex, (current) => ({
                      ...current,
                      sortOrder: Number(event.currentTarget.value),
                    }))
                  }
                  type="number"
                  value={option.sortOrder}
                />
              </Field>
              <Field className="self-end">
                <FieldLabel className="sr-only" htmlFor={`bib-option-enabled-${option.id}`}>
                  {option.displayName}启用状态
                </FieldLabel>
                <Switch
                  checked={option.enabled}
                  id={`bib-option-enabled-${option.id}`}
                  onCheckedChange={(checked) =>
                    updateOption(optionIndex, (current) => ({ ...current, enabled: checked }))
                  }
                />
              </Field>
              <Badge variant="outline">{option.dimension === "grade" ? "年级" : "班级"}</Badge>
            </FieldGroup>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => addOption("grade")} type="button" variant="outline">
              <PlusIcon data-icon="inline-start" />
              添加年级
            </Button>
            <Button onClick={() => addOption("class")} type="button" variant="outline">
              <PlusIcon data-icon="inline-start" />
              添加班级
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>属性映射</CardTitle>
          <CardDescription>同一号码同一维度命中不同输出时不能启用。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {config.mappings.map((mapping, mappingIndex) => {
            const optionItems = config.attributeOptions
              .filter((option) => option.dimension === mapping.dimension && option.enabled)
              .map((option) => ({ value: option.id, label: option.displayName }));
            return (
              <Card
                key={
                  mapping.id ??
                  `${mapping.dimension}-${mapping.outputOptionId}-${mapping.sortOrder}`
                }
                size="sm"
              >
                <CardHeader>
                  <CardTitle>{mapping.dimension === "grade" ? "年级映射" : "班级映射"}</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <FieldGroup className="md:grid md:grid-cols-3">
                    <Field>
                      <FieldLabel htmlFor={`mapping-start-${mappingIndex}`}>起始位置</FieldLabel>
                      <Input
                        id={`mapping-start-${mappingIndex}`}
                        max={12}
                        min={1}
                        onChange={(event) =>
                          updateMapping(mappingIndex, (current) => ({
                            ...current,
                            startPosition: Number(event.currentTarget.value),
                          }))
                        }
                        type="number"
                        value={mapping.startPosition}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor={`mapping-width-${mappingIndex}`}>宽度</FieldLabel>
                      <Input
                        id={`mapping-width-${mappingIndex}`}
                        max={12}
                        min={1}
                        onChange={(event) =>
                          updateMapping(mappingIndex, (current) => ({
                            ...current,
                            width: Number(event.currentTarget.value),
                          }))
                        }
                        type="number"
                        value={mapping.width}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor={`mapping-output-${mappingIndex}`}>输出选项</FieldLabel>
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
                          onChange={(event) =>
                            updateMapping(mappingIndex, (current) => ({
                              ...current,
                              ranges: current.ranges.map((currentRange, index) =>
                                index === rangeIndex
                                  ? { ...currentRange, start: event.currentTarget.value }
                                  : currentRange,
                              ),
                            }))
                          }
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
                          onChange={(event) =>
                            updateMapping(mappingIndex, (current) => ({
                              ...current,
                              ranges: current.ranges.map((currentRange, index) =>
                                index === rangeIndex
                                  ? { ...currentRange, end: event.currentTarget.value }
                                  : currentRange,
                              ),
                            }))
                          }
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
              添加年级映射
            </Button>
            <Button onClick={() => addMapping("class")} type="button" variant="outline">
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
              onChange={(event) => setTestNumber(event.currentTarget.value)}
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
