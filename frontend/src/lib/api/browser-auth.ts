"use client";

import type { components } from "./generated";
import { apiClient } from "./browser";
export { ApiError as AuthApiError } from "./client";

export const browserAuthApi = {
  signup: (body: components["schemas"]["SignupRequest"]) =>
    apiClient.post<components["schemas"]["VerificationChallengeResponse"]>("/v1/auth/signup/", body, { auth: false }),
  confirmVerification: (body: components["schemas"]["VerificationConfirmRequest"]) =>
    apiClient.post<components["schemas"]["VerificationConfirmed"]>("/v1/auth/verification/confirm/", body, { auth: false }),
  resendVerification: (body: components["schemas"]["VerificationResendRequest"]) =>
    apiClient.post<components["schemas"]["VerificationResent"]>("/v1/auth/verification/resend/", body, { auth: false }),
};
