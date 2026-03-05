import parse from 'parse-duration';

type OperatorFn = (fieldValue: unknown, conditionValue: unknown) => boolean;

export const operators: Record<string, OperatorFn> = {
  equals: (field, value) => field === value,

  not_equals: (field, value) => field !== value,

  greater_than: (field, value) => {
    if (field === null || field === undefined) return false;
    return (field as number) > (value as number);
  },

  less_than: (field, value) => {
    if (field === null || field === undefined) return false;
    return (field as number) < (value as number);
  },

  older_than: (field, value) => {
    // null dates = infinitely old = always matches older_than
    if (field === null || field === undefined) return true;
    const ms = parse(value as string);
    if (ms === null) throw new Error(`Invalid duration: "${value}"`);
    const threshold = new Date(Date.now() - ms);
    return new Date(field as string) < threshold;
  },

  newer_than: (field, value) => {
    // null dates can't be newer than anything
    if (field === null || field === undefined) return false;
    const ms = parse(value as string);
    if (ms === null) throw new Error(`Invalid duration: "${value}"`);
    const threshold = new Date(Date.now() - ms);
    return new Date(field as string) > threshold;
  },

  includes: (field, value) => {
    if (!Array.isArray(field)) return false;
    return field.includes(value);
  },

  not_includes: (field, value) => {
    if (!Array.isArray(field)) return false;
    return !field.includes(value);
  },

  includes_all: (field, value) => {
    if (!Array.isArray(field) || !Array.isArray(value)) return false;
    return value.every(v => field.includes(v));
  },

  is_empty: field => {
    if (!Array.isArray(field)) return false;
    return field.length === 0;
  },

  is_not_empty: field => {
    if (!Array.isArray(field)) return false;
    return field.length > 0;
  },
};
