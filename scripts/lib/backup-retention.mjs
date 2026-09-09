const backupPattern = /^photostream-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\.pstrbk$/u;

function parseBackupFile(name) {
  const match = backupPattern.exec(name);
  if (match === null) return null;
  const [, year, month, day, hour, minute, second] = match;
  const timestamp = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
  const date = new Date(timestamp);
  if (
    !Number.isFinite(timestamp) ||
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() !== Number(month) - 1 ||
    date.getUTCDate() !== Number(day) ||
    date.getUTCHours() !== Number(hour) ||
    date.getUTCMinutes() !== Number(minute) ||
    date.getUTCSeconds() !== Number(second)
  ) {
    return null;
  }
  return { name, date, timestamp };
}

function utcDayKey(date) {
  return date.toISOString().slice(0, 10);
}

function isoWeekKey(date) {
  const thursday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = thursday.getUTCDay() || 7;
  thursday.setUTCDate(thursday.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((thursday.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${String(thursday.getUTCFullYear())}-W${String(week).padStart(2, "0")}`;
}

export function planBackupRetention(names, options = {}) {
  const dailyCount = options.dailyCount ?? 14;
  const weeklyCount = options.weeklyCount ?? 8;
  if (!Number.isInteger(dailyCount) || dailyCount < 1)
    throw new Error("dailyCount must be positive");
  if (!Number.isInteger(weeklyCount) || weeklyCount < 0)
    throw new Error("weeklyCount must be non-negative");

  const parsed = names
    .map(parseBackupFile)
    .filter((entry) => entry !== null)
    .sort((left, right) => right.timestamp - left.timestamp);
  const keep = new Set();
  const dailyDays = new Set();
  let oldestDailyTimestamp = Number.POSITIVE_INFINITY;

  for (const entry of parsed) {
    const dayKey = utcDayKey(entry.date);
    if (dailyDays.has(dayKey) || dailyDays.size >= dailyCount) continue;
    dailyDays.add(dayKey);
    keep.add(entry.name);
    oldestDailyTimestamp = Math.min(oldestDailyTimestamp, entry.timestamp);
  }

  const weeklyWeeks = new Set();
  if (weeklyCount > 0 && Number.isFinite(oldestDailyTimestamp)) {
    for (const entry of parsed) {
      if (entry.timestamp >= oldestDailyTimestamp) continue;
      const weekKey = isoWeekKey(entry.date);
      if (weeklyWeeks.has(weekKey) || weeklyWeeks.size >= weeklyCount) continue;
      weeklyWeeks.add(weekKey);
      keep.add(entry.name);
    }
  }

  return {
    keep: parsed.filter((entry) => keep.has(entry.name)).map((entry) => entry.name),
    remove: parsed.filter((entry) => !keep.has(entry.name)).map((entry) => entry.name),
    ignored: names.filter((name) => parseBackupFile(name) === null),
  };
}

export function backupFileName(date = new Date()) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime()))
    throw new Error("date must be valid");
  return `photostream-${date
    .toISOString()
    .replace(/[-:]/gu, "")
    .replace(/\.\d{3}Z$/u, "Z")}.pstrbk`;
}
