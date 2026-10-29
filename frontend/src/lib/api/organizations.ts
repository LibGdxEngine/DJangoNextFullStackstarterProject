"use client";

import type { components } from "./generated";
import { apiClient } from "./browser";

export type Organization = components["schemas"]["Organization"];

export const organizationsApi = {
  list: () => apiClient.get<Organization[]>("/organizations/"),
  create: (body: components["schemas"]["OrganizationRequest"]) =>
    apiClient.post<Organization>("/organizations/", body),
};
