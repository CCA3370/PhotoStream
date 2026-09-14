import { z } from "zod";

export const dataSaverSettingViewSchema = z
  .object({
    enabled: z.boolean(),
  })
  .strict();
export type DataSaverSettingView = z.infer<typeof dataSaverSettingViewSchema>;

export const updateDataSaverSettingRequestSchema = dataSaverSettingViewSchema;
export type UpdateDataSaverSettingRequest = z.infer<typeof updateDataSaverSettingRequestSchema>;
