import {
  type ApiError,
  type ApiErrorCode,
  apiErrorSchema,
} from "@photostream/contracts";

const apiErrorMessages = {
  BAD_REQUEST: "提交的内容不完整或格式不正确，请检查后重试。",
  AUTH_INVALID_CREDENTIALS: "用户名或密码不正确。",
  AUTH_REQUIRED: "登录状态已失效，请重新登录。",
  AUTH_ACCOUNT_DISABLED: "该账号暂时无法使用，请联系管理员。",
  AUTH_PASSWORD_POLICY: "密码不符合要求，请按页面提示修改。",
  AUTH_CSRF_INVALID: "当前页面状态已失效，请刷新后重试。",
  AUTH_ORIGIN_INVALID: "当前页面状态异常，请刷新页面后重试。",
  AUTH_RATE_LIMITED: "操作过于频繁，请稍后再试。",
  FORBIDDEN: "你没有权限执行此操作。",
  NOT_FOUND: "未找到相关内容，可能已被删除或链接已失效。",
  CONFLICT: "内容已发生变化，请刷新后重试。",
  INTERNAL_ERROR: "服务暂时出现问题，请稍后重试。",
  SERVICE_UNAVAILABLE: "服务暂时不可用，请稍后重试。",
  ALBUM_NOT_FOUND: "未找到该相册，可能已停止服务或链接无效。",
  ALBUM_NOT_LIVE: "该相册当前不可访问。",
  ALBUM_PASSWORD_INVALID: "口令不正确，请重新输入。",
  ALBUM_PASSWORD_RATE_LIMITED: "尝试次数过多，请稍后再输入口令。",
  UPLOAD_INVALID: "这张照片无法上传，请检查文件后重试。",
  UPLOAD_NOT_FOUND: "未找到这次上传任务，请重新选择照片。",
  OBJECT_VERIFICATION_FAILED: "照片上传未完成，请重新上传。",
  STATE_CONFLICT: "当前内容已发生变化，请刷新后重试。",
  MEDIA_LIMIT_EXCEEDED: "本次照片数量超过允许范围，请减少后重试。",
  USER_NOT_FOUND: "未找到该成员。",
  MEDIA_NOT_FOUND: "未找到这张照片，可能已被删除。",
  DOWNLOAD_DISABLED: "当前相册未开放此类下载。",
  DOWNLOAD_NOT_READY: "照片仍在处理中，请稍后再下载。",
  DELETION_TASK_FAILED: "删除未能完成，请稍后重试。",
  IDEMPOTENCY_CONFLICT: "该操作已发生变化，请刷新后重试。",
  RECENT_AUTH_REQUIRED: "为确认是你本人，请重新验证密码后继续。",
  BIB_CONFIG_INVALID: "号码找照片的设置有误，请检查后重试。",
  BIB_KEYS_UNAVAILABLE: "号码找照片暂时不可用，请稍后重试。",
  BIB_TAG_NOT_FOUND: "未找到对应的号码信息。",
  BIB_NUMBER_INVALID: "请输入有效的号码。",
  BIB_MODEL_VERSION_MISMATCH: "照片识别信息已更新，请重新处理后再试。",
  BIB_RULE_VERSION_MISMATCH: "照片识别信息已更新，请重新处理后再试。",
  BIB_SEARCH_DISABLED: "该相册未开启号码找照片。",
  BIB_RECALCULATION_FAILED: "号码识别未能完成，请稍后重试。",
  FACE_SEARCH_DISABLED: "该相册未开启人脸找照片。",
  FACE_INDEX_NOT_READY: "相册照片仍在准备中，请稍后再使用人脸找照片。",
  FACE_REFERENCE_INVALID: "这张参考照片无法使用，请换一张清晰的单人正脸照。",
  FACE_NO_FACE: "没有识别到清晰人脸，请换一张正脸照片。",
  FACE_MULTIPLE_FACES: "照片中有多个人，请选择只有目标人物的照片。",
  FACE_QUALITY_LOW: "人脸不够清晰，请换一张光线更好、无遮挡的正脸照片。",
  FACE_RATE_LIMITED: "查找过于频繁，请稍后再试。",
  FACE_SEARCH_PROCESSING: "照片仍在处理中，请稍后再试。",
  FACE_PROVIDER_UNAVAILABLE: "人脸找照片暂时不可用，请稍后再试。",
  FACE_CLEANUP_FAILED: "相关照片处理未能完成，请稍后重试。",
  FACE_EVENT_SIGNATURE_INVALID: "相关照片处理未能完成，请稍后重试。",
} satisfies Record<ApiErrorCode, string>;

export function apiErrorMessage(error: Pick<ApiError, "code">): string {
  return apiErrorMessages[error.code];
}

export function httpErrorMessage(status: number): string {
  if (status === 401) return "登录状态已失效，请重新登录。";
  if (status === 403) return "当前操作无法完成，请检查权限后重试。";
  if (status === 404) return "未找到相关内容，可能已被删除或链接已失效。";
  if (status === 409) return "内容已发生变化，请刷新后重试。";
  if (status === 429) return "操作过于频繁，请稍后再试。";
  if (status >= 500) return "服务暂时不可用，请稍后重试。";
  return "操作未能完成，请检查输入后重试。";
}

function extractApiError(value: unknown): ApiError | null {
  const direct = apiErrorSchema.safeParse(value);
  if (direct.success) return direct.data;
  if (typeof value !== "object" || value === null || !("response" in value)) return null;
  const nested = apiErrorSchema.safeParse((value as { response?: unknown }).response);
  return nested.success ? nested.data : null;
}

export function userFacingErrorMessage(
  error: unknown,
  fallback = "操作未能完成，请稍后重试。",
): string {
  const apiError = extractApiError(error);
  if (apiError !== null) return apiErrorMessage(apiError);
  if (error instanceof TypeError) return "网络连接异常，请检查网络后重试。";
  if (error instanceof Error && error.name === "FaceReferenceProcessingError") {
    return error.message;
  }
  return fallback;
}
