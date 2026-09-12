import "server-only";

import type { components } from "./generated";
import { createServerApiClient } from "./server";
import type { ClientIdentity } from "./client-identity";
export { ApiError } from "./client";

export type TokenUser = components["schemas"]["TokenUser"];
export type AuthTokens = components["schemas"]["AuthTokens"];
export type SignupRequest = components["schemas"]["SignupRequest"];
export type VerificationConfirmRequest = components["schemas"]["VerificationConfirmRequest"];
export type VerificationChallenge = components["schemas"]["VerificationChallengeResponse"];

export const authApi = {
  login: (body: components["schemas"]["LoginRequest"], identity?: ClientIdentity) =>
    createServerApiClient(undefined, identity).post<AuthTokens>("/v1/auth/login/", body, { auth: false }),
  exchangeSocialToken: (provider: string, body: components["schemas"]["SocialAuthRequest"], identity?: ClientIdentity) =>
    createServerApiClient(undefined, identity).post<components["schemas"]["SocialAuthResponse"]>(
      `/v1/auth/social/${encodeURIComponent(provider)}/`, body, { auth: false },
    ),
};
