// SWR ベースの汎用 API フック — 共通基盤。画面実装で変更しないこと (READ ONLY)
import useSWR, { type SWRConfiguration } from "swr";
import { apiClient, ApiClientError } from "@/lib/api-client";

export function useApi<T>(path: string | null, options?: SWRConfiguration) {
  const { data, error, isLoading, mutate } = useSWR<T, ApiClientError>(
    path,
    (url: string) => apiClient.get<T>(url),
    { revalidateOnFocus: false, ...options },
  );
  return { data, error, isLoading, mutate };
}
