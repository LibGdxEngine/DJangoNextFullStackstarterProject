"use client";

import type { components } from "./generated";
import { apiClient } from "./browser";

type Schemas = components["schemas"];

export type VerificationChallenge = Schemas["VerificationChallengeResponse"];

/** Public (unauthenticated) account flows: signup, phone verification, password recovery. */
export const accountsApi = {
  signup: (body: Schemas["SignupRequest"]) =>
    apiClient.post<VerificationChallenge>("/v1/auth/signup/", body, { auth: false }),
  confirmVerification: (body: Schemas["VerificationConfirmRequest"]) =>
    apiClient.post<Schemas["VerificationConfirmed"]>("/v1/auth/verification/confirm/", body, { auth: false }),
  resendVerification: (body: Schemas["VerificationResendRequest"]) =>
    apiClient.post<Schemas["VerificationResent"]>("/v1/auth/verification/resend/", body, { auth: false }),
  forgotPassword: (body: Schemas["PasswordForgotRequest"]) =>
    apiClient.post<Schemas["PasswordForgotResponse"]>("/v1/auth/password/forgot/", body, { auth: false }),
  verifyPasswordReset: (body: Schemas["PasswordResetVerifyRequest"]) =>
    apiClient.post<Schemas["PasswordResetVerified"]>("/v1/auth/password/reset/verify/", body, { auth: false }),
  resetPassword: (body: Schemas["PasswordResetConfirmRequest"]) =>
    apiClient.post<unknown>("/v1/auth/password/reset/", body, { auth: false }),
};
