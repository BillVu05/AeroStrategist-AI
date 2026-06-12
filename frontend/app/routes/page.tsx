"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { getRoutes } from "@/lib/api";
import type { RoutesResponse } from "@/lib/types";
import LoadingSpinner from "@/components/LoadingSpinner";
import ErrorMessage from "@/components/ErrorMessage";
import RouteDetailsPanel from "@/components/RouteDetailsPanel";

const RouteMap = dynamic(() => import("@/components/RouteMap"), { ssr: false });

export default function RouteExplorerPage() {
  const [data, setData] = useState<RoutesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    getRoutes()
      .then(setData)
      .catch((err) => setError(err.message));
  }, []);

  if (error) return <ErrorMessage message={error} />;
  if (!data) return <LoadingSpinner />;

  const selectedRoute = data.routes.find((r) => r.destination === selected) ?? null;

  return (
    <div>
      <h1 className="mb-4 text-2xl font-semibold text-gray-900">Route Explorer</h1>
      <div className="flex flex-col gap-4 md:flex-row">
        <div className="md:w-2/3">
          <RouteMap origin={data.origin} routes={data.routes} selected={selected} onSelect={setSelected} />
        </div>
        <div className="md:w-1/3">
          <RouteDetailsPanel route={selectedRoute} origin={data.origin} />
        </div>
      </div>
    </div>
  );
}
