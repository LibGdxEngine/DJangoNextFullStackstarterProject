import "server-only";

import type { components } from "./generated";
import { createServerApiClient } from "./server";

export type TokenUser = components["schemas"]["TokenUser"];
export type AuthTokens = components["schemas"]["AuthTokens"];

export const authApi = {
  login: (body: components["schemas"]["LoginRequest"]) =>
    createServerApiClient().post<AuthTokens>("/v1/auth/login/", body, { auth: false }),
  refresh: (body: components["schemas"]["TokenRefreshRequest"]) =>
    createServerApiClient().post<components["schemas"]["TokenPair"]>("/v1/auth/token/refresh/", body, { auth: false }),
  exchangeSocialToken:(provider: string, body: components["schemas"]["SocialAuthRequest"]) =>
    createServerApiClient().post<components["schemas"]["SocialAuthResponse"]>(
      `/v1/auth/social/${encodeURIComponent(provider)}/`, body, { auth: false },
    ),
};
