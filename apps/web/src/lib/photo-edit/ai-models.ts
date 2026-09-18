export const PHOTO_EDIT_MODEL_ASSET_VERSION = "restoration-v1-20260918";
export const PHOTO_EDIT_MODEL_BASE = `/assets/models/photo-edit/${PHOTO_EDIT_MODEL_ASSET_VERSION}`;

export type PhotoEditAiOperation = "denoise" | "deblur";

export interface PhotoEditAiModelSpec {
  readonly operation: PhotoEditAiOperation;
  readonly id: string;
  readonly version: string;
  readonly modelUrl: string;
  readonly externalData:
    | {
        readonly path: string;
        readonly url: string;
      }
    | null;
  readonly tileSize: number;
  readonly overlap: number;
  readonly inputDivisor: number;
  readonly inputName: string | null;
  readonly outputName: string | null;
  readonly license: string;
}

export const photoEditAiModels: Readonly<Record<PhotoEditAiOperation, PhotoEditAiModelSpec>> = {
  denoise: {
    operation: "denoise",
    id: "scunet-color-real-psnr",
    version: "75c7857c1ae254174fbeed18fa57fe4a1acb9ecf",
    modelUrl: `${PHOTO_EDIT_MODEL_BASE}/scunet_color_real_psnr.onnx`,
    externalData: {
      path: "scunet_color_real_psnr.onnx.data",
      url: `${PHOTO_EDIT_MODEL_BASE}/scunet_color_real_psnr.onnx.data`,
    },
    tileSize: 256,
    overlap: 32,
    inputDivisor: 8,
    inputName: "image",
    outputName: "denoised",
    license: "Apache-2.0",
  },
  deblur: {
    operation: "deblur",
    id: "nafnet-deblurring-2025may",
    version: "ea498688be1d1649d0965e0e16d275ecc7cc08ac",
    modelUrl: `${PHOTO_EDIT_MODEL_BASE}/deblurring_nafnet_2025may.onnx`,
    externalData: null,
    tileSize: 256,
    overlap: 32,
    inputDivisor: 16,
    inputName: null,
    outputName: null,
    license: "MIT",
  },
};
