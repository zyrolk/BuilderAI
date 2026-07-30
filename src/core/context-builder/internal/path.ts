export function normalizeProjectPath(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\.\//, '');
}

export function isSafeProjectPath(value: string): boolean {
  const normalized = normalizeProjectPath(value);
  return (
    normalized.length > 0 &&
    !normalized.startsWith('/') &&
    !/^[a-z]:\//i.test(normalized) &&
    !normalized.split('/').includes('..')
  );
}

export function pathBelongsToModule(filePath: string, modulePath: string): boolean {
  const file = normalizeProjectPath(filePath);
  const normalizedModule = normalizeProjectPath(modulePath).replace(/\/$/, '');
  return file === normalizedModule || file.startsWith(`${normalizedModule}/`);
}

export function directoryName(filePath: string): string {
  const parts = normalizeProjectPath(filePath).split('/');
  parts.pop();
  return parts.join('/');
}

export function resolveRelativePath(fromDirectory: string, relativePath: string): string {
  const parts = `${fromDirectory}/${relativePath}`.split('/');
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (resolved.length === 0 || resolved.at(-1) === '..') resolved.push('..');
      else resolved.pop();
    } else resolved.push(part);
  }
  return resolved.join('/');
}
