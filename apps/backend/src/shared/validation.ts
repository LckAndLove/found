import { BadRequestError } from "./errors.js";

const FUND_CODE_PATTERN = /^\d{6}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function requireFundCode(value: unknown, name = "code") {
  if (typeof value !== "string" || !FUND_CODE_PATTERN.test(value)) {
    throw new BadRequestError(`${name} 必须是 6 位基金代码`, { [name]: value });
  }

  return value;
}

export function requireNonEmptyString(value: unknown, name: string) {
  if (Array.isArray(value)) {
    throw new BadRequestError(`${name} 不能为空`, { [name]: value });
  }

  const text = String(value ?? "").trim();
  if (!text) {
    throw new BadRequestError(`${name} 不能为空`, { [name]: value });
  }

  return text;
}

export function optionalTrimmedString(value: unknown, name: string) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new BadRequestError(`${name} 必须是字符串`, { [name]: value });
  }

  const text = value.trim();
  return text ? text : null;
}

export function requireDateString(value: unknown, name: string) {
  if (typeof value !== "string") {
    throw new BadRequestError(`${name} 必须是 YYYY-MM-DD 格式`, { [name]: value });
  }

  const text = String(value ?? "");
  if (!DATE_PATTERN.test(text)) {
    throw new BadRequestError(`${name} 必须是 YYYY-MM-DD 格式`, { [name]: value });
  }

  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    throw new BadRequestError(`${name} 必须是有效日期`, { [name]: value });
  }

  return text;
}

export function optionalBoolean(value: unknown, fallback: boolean) {
  if (value === undefined) {
    return fallback;
  }

  if (value === "true" || value === "1" || value === true) {
    return true;
  }

  if (value === "false" || value === "0" || value === false) {
    return false;
  }

  throw new BadRequestError("布尔参数必须是 true/false 或 1/0", { value });
}

export function optionalInteger(value: unknown, fallback: number, options: { name: string; min: number; max: number }) {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < options.min || parsed > options.max) {
    throw new BadRequestError(`${options.name} 必须是 ${options.min} 到 ${options.max} 的整数`, {
      [options.name]: value
    });
  }

  return parsed;
}
