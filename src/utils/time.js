import { appTimeZone } from './config.js';

let formatter = null;
const getFormatter = () => {
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: appTimeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
  }
  return formatter;
};

const APP_WEEKDAYS = {
  Sun: 'So',
  Mon: 'Mo',
  Tue: 'Di',
  Wed: 'Mi',
  Thu: 'Do',
  Fri: 'Fr',
  Sat: 'Sa',
};

const toMap = (date) => {
  const map = {};
  for (const part of getFormatter().formatToParts(date)) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  return map;
};

export const getAppTimeZone = () => appTimeZone;

export const getZonedNow = () => {
  const m = toMap(new Date());
  return {
    year: Number(m.year),
    month: Number(m.month),
    day: Number(m.day),
    dayCode: APP_WEEKDAYS[m.weekday] || 'So',
    hour: Number(m.hour),
    minute: Number(m.minute),
  };
};

export const getZonedDateStr = () => {
  const { year, month, day } = getZonedNow();
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

export const getZonedMonthStr = () => {
  const { year, month } = getZonedNow();
  return `${year}-${String(month).padStart(2, '0')}`;
};

// Convert a UTC "YYYY-MM-DD HH:MM:SS" timestamp (SQLite CURRENT_TIMESTAMP)
// to a date string in the app timezone.
export const formatUtcTimestampInAppZone = (ts) => {
  if (!ts) return '';
  const raw = String(ts).trim();
  let date;
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(raw)) {
    date = new Date(`${raw.replace(' ', 'T')}Z`);
  } else {
    date = new Date(raw);
  }
  if (Number.isNaN(date.getTime())) return raw.slice(0, 10);
  const m = toMap(date);
  return `${m.year}-${m.month}-${m.day}`;
};
