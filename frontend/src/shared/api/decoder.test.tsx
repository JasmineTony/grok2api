import { describe, expect, it } from "vitest";

import {
  createObjectDecoder,
  createPaginatedDecoder,
  createValidatedDecoder,
  decodeBooleanResult,
  decodeCountResult,
  hasShape,
  isArrayOf,
  isBoolean,
  isNumber,
  isObject,
  isOneOf,
  isOptional,
  isRecordOf,
  isString,
  type ValueValidator,
} from "@/shared/api/decoder";

// decoder 是外部输入的唯一校验边界：逐项覆盖每个 validator 的真/假分支与
// 组合校验器（hasShape / isRecordOf / isArrayOf / isOneOf / isOptional）的边界值。

describe("基础类型校验器", () => {
  it("isString 只接受字符串", () => {
    expect(isString("a")).toBe(true);
    expect(["", String(1)]).toHaveLength(2);
    expect(isString(1)).toBe(false);
    expect(isString(undefined)).toBe(false);
    expect(isString(null)).toBe(false);
  });

  it("isNumber 拒绝 NaN 与 Infinity", () => {
    expect(isNumber(0)).toBe(true);
    expect(isNumber(-1.5)).toBe(true);
    expect(isNumber(Number.NaN)).toBe(false);
    expect(isNumber(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isNumber("1")).toBe(false);
  });

  it("isBoolean 只接受布尔值", () => {
    expect(isBoolean(true)).toBe(true);
    expect(isBoolean(false)).toBe(true);
    expect(isBoolean(0)).toBe(false);
    expect(isBoolean("true")).toBe(false);
  });

  it("isObject 拒绝 null 与数组", () => {
    expect(isObject({})).toBe(true);
    expect(isObject({ a: 1 })).toBe(true);
    expect(isObject(null)).toBe(false);
    expect(isObject([])).toBe(false);
    expect(isObject("x")).toBe(false);
  });
});

describe("组合校验器", () => {
  it("isOptional 放行 undefined 但继续校验其余值", () => {
    const optionalString = isOptional(isString);

    expect(optionalString(undefined)).toBe(true);
    expect(optionalString("a")).toBe(true);
    expect(optionalString(null)).toBe(false);
    expect(optionalString(1)).toBe(false);
  });

  it("isArrayOf 要求每一项都通过", () => {
    const strings = isArrayOf(isString);

    expect(strings([])).toBe(true);
    expect(strings(["a", "b"])).toBe(true);
    expect(strings(["a", 1])).toBe(false);
    expect(strings("a")).toBe(false);
  });

  it("isRecordOf 只接受纯对象且每个值都通过", () => {
    const numbers = isRecordOf(isNumber);

    expect(numbers({})).toBe(true);
    expect(numbers({ a: 1, b: 2 })).toBe(true);
    expect(numbers({ a: 1, b: "2" })).toBe(false);
    expect(numbers(null)).toBe(false);
    expect(numbers([])).toBe(false);
  });

  it("isOneOf 只接受枚举内的字符串", () => {
    const validator = isOneOf("a", "b");

    expect(validator("a")).toBe(true);
    expect(validator("b")).toBe(true);
    expect(validator("c")).toBe(false);
    expect(validator(1)).toBe(false);
  });

  it("hasShape 逐字段校验且拒绝非对象", () => {
    const validator = hasShape({ id: isString, count: isOptional(isNumber) });

    expect(validator({ id: "a" })).toBe(true);
    expect(validator({ id: "a", count: 2 })).toBe(true);
    expect(validator({ id: "a", count: "2" })).toBe(false);
    expect(validator({ id: 1 })).toBe(false);
    expect(validator(null)).toBe(false);
    expect(validator([{ id: "a" }])).toBe(false);
  });
});

describe("解码器工厂", () => {
  it("createValidatedDecoder 通过时原样返回，失败时抛出带名称的错误", () => {
    const decode = createValidatedDecoder<{ id: string }>("admin", hasShape({ id: isString }));

    expect(decode({ id: "a1" })).toEqual({ id: "a1" });
    expect(() => decode({ id: 1 })).toThrowError("admin response shape is invalid");
  });

  it("createObjectDecoder 组合 hasShape 并保留错误文案", () => {
    const decode = createObjectDecoder<{ ok: boolean }>("boolean result", { ok: isBoolean });

    expect(decode({ ok: false })).toEqual({ ok: false });
    expect(() => decode({ ok: "no" })).toThrowError("boolean result response shape is invalid");
  });

  it("decodeBooleanResult / decodeCountResult 只校验指定字段", () => {
    const decodeDeleted = decodeBooleanResult<{ deleted: boolean }>("deleted");
    const decodeCount = decodeCountResult<{ deleted: number }>("deleted");

    expect(decodeDeleted({ deleted: true })).toEqual({ deleted: true });
    expect(() => decodeDeleted({ deleted: 1 })).toThrowError("boolean result response shape is invalid");

    expect(decodeCount({ deleted: 3 })).toEqual({ deleted: 3 });
    expect(() => decodeCount({ deleted: "3" })).toThrowError("count result response shape is invalid");
  });

  it("createPaginatedDecoder 校验 items/page/pageSize/total 四项", () => {
    const decode = createPaginatedDecoder<{ id: string }>(hasShape({ id: isString }));
    const valid = { items: [{ id: "a" }], page: 1, pageSize: 20, total: 1 };

    expect(decode(valid)).toEqual(valid);
    expect(() => decode({ ...valid, items: [{ id: 1 }] })).toThrowError("paginated result response shape is invalid");
    expect(() => decode({ ...valid, total: "1" })).toThrowError("paginated result response shape is invalid");
    expect(() => decode(null)).toThrowError("paginated result response shape is invalid");
  });
});

describe("ValueValidator 契约", () => {
  it("自定义 validator 可组合进 hasShape", () => {
    const nonEmpty: ValueValidator = (value) => typeof value === "string" && value.length > 0;
    const decode = createObjectDecoder<{ name: string }>("named", { name: nonEmpty });

    expect(decode({ name: "a" })).toEqual({ name: "a" });
    expect(() => decode({ name: "" })).toThrowError("named response shape is invalid");
  });
});
