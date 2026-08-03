import type { AIProviderError } from '../../core/ai-provider';
import {
  InvalidProviderConfigurationError,
  ProviderContractViolationError,
} from '../../core/ai-provider';

export interface WorkspaceHttpErrorBody {
  readonly code: string;
  readonly message: string;
  readonly issues?: readonly { readonly path: string; readonly message: string }[];
}

export function mapAiProviderErrorResponse(error: AIProviderError): {
  readonly status: number;
  readonly body: WorkspaceHttpErrorBody;
} {
  if (error instanceof ProviderContractViolationError) {
    return {
      status: 422,
      body: { code: error.code, message: error.message, issues: error.issues },
    };
  }
  if (error instanceof InvalidProviderConfigurationError) {
    return {
      status: 422,
      body: { code: error.code, message: error.message, issues: error.issues },
    };
  }
  const status = error.code === 'PROVIDER_UNAVAILABLE' ? 503 : error.code === 'TIMEOUT' ? 504 : 422;
  return {
    status,
    body: { code: error.code, message: error.message },
  };
}
