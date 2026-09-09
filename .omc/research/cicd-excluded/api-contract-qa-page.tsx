"use client";
import { useState } from "react";
import { useSession } from "next-auth/react";
import { apiClient } from "@/lib/api/browser";
export default function ApiContractQa() {
  const { data: session } = useSession();
  const [result, setResult] = useState("Ready");
  return <main><h1>Temporary API contract test</h1><button onClick={async () => {
    try { await apiClient.get("/v1/auth/me/"); setResult("Protected request succeeded"); }
    catch (error) { setResult(error instanceof Error ? error.message : "Request failed"); }
  }}>Check protected profile</button><p>{result}</p><p>{session?.sessionExpired ? "Session expired" : session?.accessToken ? "Session active" : "Signed out"}</p></main>;
}
