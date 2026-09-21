export async function convertImageToJpeg(blob: Blob, quality = 0.92): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { alpha: false });
    if (context === null) throw new Error("当前浏览器无法转换 JPG 图片");

    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (jpeg) => {
          if (jpeg === null || jpeg.size === 0 || jpeg.type !== "image/jpeg") {
            reject(new Error("JPG 图片转换失败"));
            return;
          }
          resolve(jpeg);
        },
        "image/jpeg",
        quality,
      );
    });
  } finally {
    bitmap.close();
  }
}
