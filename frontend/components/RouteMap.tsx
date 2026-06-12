"use client";

import React from "react";
import L from "leaflet";
import { MapContainer, TileLayer, Marker, Popup, Polyline } from "react-leaflet";
import type { AirportInfo, RouteInfo } from "@/lib/types";

// Next.js bundling breaks Leaflet's default marker icon paths — point them
// at the CDN copies instead.
delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

interface RouteMapProps {
  origin: AirportInfo;
  routes: RouteInfo[];
  selected: string | null;
  onSelect: (destination: string) => void;
}

export default function RouteMap({ origin, routes, selected, onSelect }: RouteMapProps) {
  return (
    <MapContainer
      center={[origin.lat, origin.lon]}
      zoom={4}
      style={{ height: "500px", width: "100%" }}
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      />
      <Marker position={[origin.lat, origin.lon]}>
        <Popup>
          {origin.name} ({origin.iata}) — base
        </Popup>
      </Marker>
      {routes.map((route) => (
        <React.Fragment key={route.destination}>
          <Marker
            position={[route.lat, route.lon]}
            eventHandlers={{ click: () => onSelect(route.destination) }}
          >
            <Popup>
              {route.destination_name} ({route.destination})
            </Popup>
          </Marker>
          <Polyline
            positions={[
              [origin.lat, origin.lon],
              [route.lat, route.lon],
            ]}
            pathOptions={{
              color: route.status === "active" ? "#2563eb" : "#9ca3af",
              dashArray: route.status === "candidate" ? "6 4" : undefined,
              weight: selected === route.destination ? 4 : 2,
            }}
            eventHandlers={{ click: () => onSelect(route.destination) }}
          />
        </React.Fragment>
      ))}
    </MapContainer>
  );
}
