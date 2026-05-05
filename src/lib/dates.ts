import { addDays, format, isAfter, parseISO, startOfWeek, subDays } from 'date-fns';

export const toDateKey = (date: Date) => format(date, 'yyyy-MM-dd');

export const todayKey = () => toDateKey(new Date());

export const weekRange = (date = new Date()) => {
  const start = startOfWeek(date, { weekStartsOn: 1 });
  const days = Array.from({ length: 7 }, (_, index) => toDateKey(addDays(start, index)));

  return {
    start: toDateKey(start),
    end: days[6],
    days,
  };
};

export const currentStreak = (dates: string[]) => {
  const checkedDates = new Set(dates);
  let cursor = new Date();
  let streak = 0;

  while (checkedDates.has(toDateKey(cursor))) {
    streak += 1;
    cursor = subDays(cursor, 1);
  }

  return streak;
};

export const isRecentFirst = (a: string, b: string) => {
  const left = parseISO(a);
  const right = parseISO(b);
  return isAfter(left, right) ? -1 : isAfter(right, left) ? 1 : 0;
};
