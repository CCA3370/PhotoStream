const shanghaiOffsetMs = 8 * 60 * 60 * 1_000;

export function shanghaiInputValue(date: Date): string {
  return new Date(date.getTime() + shanghaiOffsetMs).toISOString().slice(0, 16);
}

export function parseShanghaiInputValue(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/u.exec(value);
  if (match === null) return new Date(Number.NaN);
  const [, year, month, day, hour, minute] = match;
  const localUtc = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
  );
  const parsed = new Date(localUtc - shanghaiOffsetMs);
  return shanghaiInputValue(parsed) === value ? parsed : new Date(Number.NaN);
}
