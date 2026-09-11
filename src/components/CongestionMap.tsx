"use client";

import "leaflet/dist/leaflet.css";
import { MapContainer, TileLayer, CircleMarker, Tooltip, Popup } from "react-leaflet";

export type MapFeeder = {
  _id: string;
  code: string;
  name: string;
  capacityKw: number;
  currentLoadKw: number;
  congestionLevel: string;
  location: { lat: number; lng: number };
};

// Gandhinagar city centre — the sectors fan out around this point.
const GANDHINAGAR_CENTER: [number, number] = [23.2156, 72.6369];

const CONGESTION_COLOR: Record<string, string> = {
  low: "#38a169", // leaf
  medium: "#d69e2e", // amber
  high: "#e53e3e", // red
};

export default function CongestionMap({ feeders }: { feeders: MapFeeder[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-neutral-200">
      <MapContainer
        center={GANDHINAGAR_CENTER}
        zoom={13}
        scrollWheelZoom
        style={{ height: 520, width: "100%" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {feeders.map((f) => {
          const color = CONGESTION_COLOR[f.congestionLevel] ?? "#718096";
          const util = f.capacityKw ? f.currentLoadKw / f.capacityKw : 0;
          // Radius scales with utilisation so busy feeders read bigger (min 12px).
          const radius = 12 + Math.min(1, util) * 20;
          return (
            <CircleMarker
              key={f._id}
              center={[f.location.lat, f.location.lng]}
              radius={radius}
              pathOptions={{ color, fillColor: color, fillOpacity: 0.5, weight: 2 }}
            >
              <Tooltip permanent direction="top" offset={[0, -radius]}>
                <span className="text-xs font-semibold">{f.code}</span>
              </Tooltip>
              <Popup>
                <div className="space-y-1 text-sm">
                  <div className="font-semibold">{f.name}</div>
                  <div>Load: {f.currentLoadKw.toFixed(1)} / {f.capacityKw} kW</div>
                  <div>Utilisation: {(util * 100).toFixed(0)}%</div>
                  <div className="capitalize">
                    Congestion: <span style={{ color }}>{f.congestionLevel}</span>
                  </div>
                </div>
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>
    </div>
  );
}
