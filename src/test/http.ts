import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios';

interface AxiosResponseOverrides {
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
}

/**
 * Wraps data in an `AxiosResponse` for testing HTTP client consumers.
 *
 * The `config` field is cast from an empty object because `InternalAxiosRequestConfig`
 * has many required fields that are irrelevant to tests — no test in this codebase
 * consumes the config field, so a full mock would be pure noise.
 */
export function axiosResponse<T>(
  data: T,
  overrides: AxiosResponseOverrides = {},
): AxiosResponse<T> {
  return {
    data,
    status: overrides.status ?? 200,
    statusText: overrides.statusText ?? 'OK',
    headers: overrides.headers ?? {},
    config: {} as InternalAxiosRequestConfig,
  };
}
