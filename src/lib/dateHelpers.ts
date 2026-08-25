// src/utils/dateHelpers.ts
export function getNextOccurrence(dayOfWeek: number) {
  const today = new Date();
  const resultDate = new Date(today.getTime());

  resultDate.setDate(today.getDate() + (7 + dayOfWeek - today.getDay()) % 7);

  if (resultDate < today) {
    resultDate.setDate(resultDate.getDate() + 7);
  }

  return resultDate;
}