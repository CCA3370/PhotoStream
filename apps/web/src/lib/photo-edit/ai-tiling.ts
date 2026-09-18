export interface PhotoEditTile {
  readonly contributionX: number;
  readonly contributionY: number;
  readonly contributionWidth: number;
  readonly contributionHeight: number;
  readonly inputX: number;
  readonly inputY: number;
  readonly inputSize: number;
  readonly cropOffset: number;
}

function starts(length: number, stride: number): readonly number[] {
  const values: number[] = [];
  for (let value = 0; value < length; value += stride) values.push(value);
  return values.length === 0 ? [0] : values;
}

export function createPhotoEditTiles(options: {
  readonly width: number;
  readonly height: number;
  readonly tileSize: number;
  readonly overlap: number;
}): readonly PhotoEditTile[] {
  const { width, height, tileSize, overlap } = options;
  if (width <= 0 || height <= 0) return [];
  if (tileSize <= overlap * 2 || overlap <= 0) {
    throw new Error("无效的 AI tile/overlap 配置");
  }

  const cropOffset = Math.floor(overlap / 2);
  const contributionSize = tileSize - cropOffset * 2;
  const stride = contributionSize - overlap;
  if (stride <= 0) throw new Error("AI tile stride 必须大于 0");

  const tiles: PhotoEditTile[] = [];
  for (const contributionY of starts(height, stride)) {
    for (const contributionX of starts(width, stride)) {
      tiles.push({
        contributionX,
        contributionY,
        contributionWidth: Math.min(contributionSize, width - contributionX),
        contributionHeight: Math.min(contributionSize, height - contributionY),
        inputX: contributionX - cropOffset,
        inputY: contributionY - cropOffset,
        inputSize: tileSize,
        cropOffset,
      });
    }
  }
  return tiles;
}

export function reflectPhotoEditIndex(index: number, length: number): number {
  if (length <= 1) return 0;
  let value = index;
  while (value < 0 || value >= length) {
    if (value < 0) value = -value - 1;
    if (value >= length) value = length * 2 - value - 1;
  }
  return value;
}

function smoothstep(value: number): number {
  const clamped = Math.min(1, Math.max(0, value));
  return clamped * clamped * (3 - 2 * clamped);
}

export function photoEditFeatherWeight(options: {
  readonly local: number;
  readonly start: number;
  readonly size: number;
  readonly total: number;
  readonly overlap: number;
}): number {
  const { local, start, size, total, overlap } = options;
  let weight = 1;
  if (start > 0 && local < overlap) {
    weight = Math.min(weight, smoothstep((local + 0.5) / overlap));
  }
  if (start + size < total && local >= size - overlap) {
    weight = Math.min(weight, smoothstep((size - local - 0.5) / overlap));
  }
  return Math.max(0.001, weight);
}
