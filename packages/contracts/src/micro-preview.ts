import { z } from "zod";

export const microPreviewLongEdgePx = 240;

export function microPreviewDimensions(width: number, height: number) {
  const scale = Math.min(1, microPreviewLongEdgePx / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export const microPreviewUploadRequestSchema = z
  .object({
    format: z.enum(["webp", "jpeg"]),
    contentType: z.enum(["image/webp", "image/jpeg"]),
    width: z.number().int().min(1).max(microPreviewLongEdgePx),
    height: z.number().int().min(1).max(microPreviewLongEdgePx),
    bytes: z
      .number()
      .int()
      .min(1)
      .max(2 * 1024 * 1024),
  })
  .strict()
  .superRefine((value, context) => {
    const expected = value.format === "jpeg" ? "image/jpeg" : "image/webp";
    if (value.contentType !== expected) {
      context.addIssue({
        code: "custom",
        message: "极小缩略图格式与 Content-Type 必须一致",
        path: ["contentType"],
      });
    }
  });

export type MicroPreviewUploadRequest = z.infer<typeof microPreviewUploadRequestSchema>;
