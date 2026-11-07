import type { Warning, WarningCode, WarningSeverity } from './model.js';

export function warning(
  code: WarningCode,
  message: string,
  path: string,
  layerId?: string,
  severity: WarningSeverity = 'warning',
): Warning {
  return layerId === undefined
    ? { code, message, path, severity }
    : { code, message, path, layerId, severity };
}

export function pushWarning(
  warnings: Warning[],
  code: WarningCode,
  message: string,
  path: string,
  layerId?: string,
): void {
  warnings.push(warning(code, message, path, layerId));
}
