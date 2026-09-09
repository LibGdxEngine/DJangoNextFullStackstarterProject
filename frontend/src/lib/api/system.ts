"use client";

import type { components } from "./generated";
import { apiClient } from "./browser";

export const systemApi = {
  hello: () => apiClient.get<components["schemas"]["HelloResponse"]>("/hello/", { auth: false }),
  status: () => apiClient.get<components["schemas"]["SystemStatus"]>("/status/", { auth: false }),
};
