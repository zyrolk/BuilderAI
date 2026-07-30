import type { ValidationIssue } from '../types';

type StringOptions = {
  readonly minLength?: number;
  readonly maxLength?: number;
};

export class ValidationContext {
  readonly issues: ValidationIssue[] = [];

  add(path: string, message: string): void {
    this.issues.push({ path, message });
  }

  object(
    value: unknown,
    path: string,
    requiredKeys: readonly string[],
    optionalKeys: readonly string[] = [],
  ): Record<string, unknown> | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      this.add(path, 'must be an object');
      return null;
    }

    const record = value as Record<string, unknown>;
    const allowedKeys = new Set([...requiredKeys, ...optionalKeys]);

    for (const key of requiredKeys) {
      if (!(key in record)) {
        this.add(`${path}.${key}`, 'is required');
      }
    }

    for (const key of Object.keys(record)) {
      if (!allowedKeys.has(key)) {
        this.add(`${path}.${key}`, 'is not allowed');
      }
    }

    return record;
  }

  string(value: unknown, path: string, options: StringOptions = {}): value is string {
    if (typeof value !== 'string') {
      this.add(path, 'must be a string');
      return false;
    }

    const minLength = options.minLength ?? 1;
    const maxLength = options.maxLength ?? 5_000;
    const length = value.trim().length;

    if (length < minLength || length > maxLength) {
      this.add(path, `must contain between ${minLength} and ${maxLength} characters`);
      return false;
    }

    return true;
  }

  identifier(value: unknown, path: string): value is string {
    if (!this.string(value, path, { maxLength: 100 })) {
      return false;
    }

    if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value)) {
      this.add(path, 'must be a lowercase kebab-case identifier');
      return false;
    }

    return true;
  }

  timestamp(value: unknown, path: string): value is string {
    if (!this.string(value, path, { maxLength: 30 })) {
      return false;
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
      this.add(path, 'must be an ISO 8601 UTC timestamp');
      return false;
    }

    return true;
  }

  boolean(value: unknown, path: string): value is boolean {
    if (typeof value !== 'boolean') {
      this.add(path, 'must be a boolean');
      return false;
    }
    return true;
  }

  enumeration<const T extends readonly string[]>(
    value: unknown,
    path: string,
    allowed: T,
  ): value is T[number] {
    if (typeof value !== 'string' || !allowed.includes(value)) {
      this.add(path, `must be one of: ${allowed.join(', ')}`);
      return false;
    }
    return true;
  }

  array(
    value: unknown,
    path: string,
    validateItem: (item: unknown, itemPath: string) => void,
  ): value is readonly unknown[] {
    if (!Array.isArray(value)) {
      this.add(path, 'must be an array');
      return false;
    }

    value.forEach((item, index) => validateItem(item, `${path}[${index}]`));
    return true;
  }

  stringArray(value: unknown, path: string): value is readonly string[] {
    return this.array(value, path, (item, itemPath) => {
      this.string(item, itemPath);
    });
  }

  unique(values: readonly string[], path: string, label: string): void {
    const seen = new Set<string>();
    for (const value of values) {
      if (seen.has(value)) {
        this.add(path, `${label} '${value}' must be unique`);
      }
      seen.add(value);
    }
  }
}
