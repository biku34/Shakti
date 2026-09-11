"use client";

import "leaflet/dist/leaflet.css";
import { MapContainer, TileLayer, CircleMarker, Tooltip, ZoomControl } from "react-leaflet";

// Gandhinagar city centre — the platform's pilot grid.
const GANDHINAGAR_CENTER: [number, number] = [23.2156, 72.6369];

// A few illustrative rooftop-solar / feeder / REC nodes scattered across the
// city, purely decorative for the hero map.
const NODES: { pos: [number, number]; label: string; color: string }[] = [
  { pos: [23.2245, 72.6502], label: "Sector 21 · Prosumer cluster", color: "#38a169" },
  { pos: [23.2098, 72.6281], label: "Sector 7 · Feeder F-12", color: "#2b6cb0" },
  { pos: [23.2312, 72.6415], label: "Infocity · Solar park", color: "#f5a623" },
  { pos: [23.1987, 72.6448], label: "Sector 28 · REC issuer", color: "#38a169" },
  { pos: [23.2189, 72.6198], label: "Sector 11 · Feeder F-04", color: "#2b6cb0" },
  { pos: [23.2401, 72.6339], label: "Kudasan · Rooftop grid", color: "#f5a623" },
];

export default function LandingMap() {
  return (
    <MapContainer
      center={GANDHINAGAR_CENTER}
      zoom={13}
      minZoom={11}
      maxZoom={17}
      zoomControl={false}
      scrollWheelZoom
      doubleClickZoom
      dragging
      attributionControl={false}
      preferCanvas
      style={{ height: "100%", width: "100%" }}
    >
      {/* OpenStreetMap — key-free, reliable basemap. */}
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
      />
      <ZoomControl position="bottomright" />
      {NODES.map((n) => (
        <CircleMarker
          key={n.label}
          center={n.pos}
          radius={9}
          pathOptions={{
            color: "#fff",
            weight: 2,
            fillColor: n.color,
            fillOpacity: 0.95,
          }}
        >
          <Tooltip direction="top" offset={[0, -6]} opacity={1}>
            <span className="text-[11px] font-semibold">{n.label}</span>
          </Tooltip>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}
