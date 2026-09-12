"use client";

import "leaflet/dist/leaflet.css";
import { Fragment, useMemo, useState } from "react";
import { MapContainer, TileLayer, Circle, CircleMarker, Tooltip, Popup } from "react-leaflet";
import { classifyCongestion, CONGESTION_LABEL, type CongestionLevel } from "@/lib/congestion";
import { transferOptions, type TransferOption } from "@/lib/transfer";
import type { Zone } from "@/lib/zones";

export type MapFeeder = {
  _id: string;
  code: string;
  name: string;
  capacityKw: number;
  currentLoadKw: number;
  availableSurplusKwh: number;
  congestionLevel: string;
  location: { lat: number; lng: number };
};

// Gandhinagar city centre — the feeder network is scattered across the city.
const GANDHINAGAR_CENTER: [number, number] = [23.2030, 72.6370];

const CONGESTION_COLOR: Record<CongestionLevel, string> = {
  low: "#38a169", // leaf
  risky: "#dd6b20", // orange
  high: "#e53e3e", // red
  critical: "#9b2c2c", // dark red
};

// Dropdown + confirm shown inside the popup of a high/critical zone.
function TransferControl({
  options,
  onTransfer,
}: {
  options: TransferOption<Zone>[];
  onTransfer: (opt: TransferOption<Zone>) => void;
}) {
  const [idx, setIdx] = useState(0);
  const selected = Math.min(idx, options.length - 1);
  const opt = options[selected];
  return (
    <div className="mt-2.5 border-t border-neutral-200 pt-2.5">
      <div className="mb-1.5 text-xs font-semibold text-neutral-700">Relieve via tie-switch transfer</div>

      {/* Selectable target list — one clean row per tie-adjacent feeder. */}
      <div className="flex flex-col gap-1" role="radiogroup" aria-label="Transfer target">
        {options.map((o, i) => {
          const active = i === selected;
          return (
            <button
              key={o.target.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setIdx(i)}
              className={`flex w-full items-center justify-between gap-3 rounded-lg border px-2.5 py-1.5 text-left text-xs transition ${
                active
                  ? "border-red-300 bg-red-50 ring-1 ring-red-200"
                  : "border-neutral-200 bg-white hover:border-neutral-300 hover:bg-neutral-50"
              }`}
            >
              <span className="flex items-center gap-1.5 font-medium text-neutral-800">
                <span
                  className={`h-2 w-2 flex-none rounded-full border ${
                    active ? "border-red-500 bg-red-500" : "border-neutral-300"
                  }`}
                />
                {o.target.area}
              </span>
              <span className="flex-none tabular-nums text-neutral-500">move {o.transferKw} kWh</span>
            </button>
          );
        })}
      </div>

      <div className="mt-2 rounded-md bg-neutral-50 px-2.5 py-1.5 text-[11px] leading-snug text-neutral-600">
        This zone {opt.source.before.toFixed(0)}% → <b className="text-neutral-900">{opt.source.after.toFixed(0)}%</b>
        <br />
        {opt.target.area} {opt.dest.before.toFixed(0)}% → <b className="text-neutral-900">{opt.dest.after.toFixed(0)}%</b>{" "}
        ({CONGESTION_LABEL[opt.destLevelAfter]})
      </div>

      <button
        type="button"
        onClick={() => onTransfer(opt)}
        className="mt-2 w-full rounded-lg bg-red-600 px-2 py-1.5 text-xs font-semibold text-white transition hover:bg-red-700"
      >
        Confirm transfer
      </button>
    </div>
  );
}

function ZoneCircle({
  z,
  options,
  onTransfer,
}: {
  z: Zone;
  options: TransferOption<Zone>[];
  onTransfer: (opt: TransferOption<Zone>) => void;
}) {
  const level = classifyCongestion(z.loadKw, z.capacityKw);
  const color = CONGESTION_COLOR[level];
  const pct = ((z.loadKw / z.capacityKw) * 100).toFixed(1);
  const congested = level === "high" || level === "critical";
  return (
    <Circle
      center={z.center}
      radius={z.radiusM}
      pathOptions={{ color, fillColor: color, fillOpacity: 0.35, weight: 1, opacity: 0.9 }}
    >
      <Tooltip direction="center" opacity={0.9}>
        <span className="text-[11px] font-semibold">{z.area}</span>
      </Tooltip>
      <Popup minWidth={230}>
        <div className="space-y-1 text-sm">
          <div className="font-semibold">
            {z.area} <span className="font-normal text-neutral-400">({z.code})</span>
          </div>
          <div>Load: {z.loadKw.toFixed(1)} / {z.capacityKw} kWh</div>
          <div>Utilisation: {pct}%</div>
          <div className="capitalize">
            Congestion: <span style={{ color }}>{CONGESTION_LABEL[level]}</span>
          </div>
          {congested && options.length > 0 && (
            <TransferControl options={options} onTransfer={onTransfer} />
          )}
          {congested && options.length === 0 && (
            <div className="mt-2 border-t border-neutral-200 pt-2 text-[11px] text-neutral-400">
              No tie-adjacent feeder has spare headroom.
            </div>
          )}
        </div>
      </Popup>
    </Circle>
  );
}

export default function CongestionMap({
  feeders,
  zones,
  onTransfer,
}: {
  feeders: MapFeeder[];
  zones: Zone[];
  onTransfer: (srcId: string, opt: TransferOption<Zone>) => void;
}) {
  const zoneMap = useMemo(() => new Map(zones.map((z) => [z.id, z] as const)), [zones]);

  return (
    <div className="overflow-hidden rounded-xl border border-neutral-200">
      <MapContainer
        center={GANDHINAGAR_CENTER}
        zoom={13}
        minZoom={11}
        maxZoom={18}
        scrollWheelZoom
        preferCanvas
        zoomSnap={0.25}
        zoomDelta={0.5}
        wheelPxPerZoomLevel={140}
        zoomAnimation
        fadeAnimation
        markerZoomAnimation
        style={{ height: 560, width: "100%" }}
      >
        {/* OpenStreetMap — key-free, reliable basemap. */}
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
        />

        {/* Synthetic feeder coverage field scattered across Gandhinagar. */}
        {zones.map((z) => {
          const level = classifyCongestion(z.loadKw, z.capacityKw);
          const options =
            level === "high" || level === "critical" ? transferOptions(z, zoneMap) : [];
          return (
            <ZoneCircle
              key={z.id}
              z={z}
              options={options}
              onTransfer={(opt) => onTransfer(z.id, opt)}
            />
          );
        })}

        {/* Live feeders from the DB, drawn as coverage circles + labelled markers. */}
        {feeders.map((f) => {
          // Congestion detected from accumulated available surplus (kWh) vs capacity.
          const level = classifyCongestion(f.availableSurplusKwh, f.capacityKw);
          const color = CONGESTION_COLOR[level];
          const util = f.capacityKw ? f.availableSurplusKwh / f.capacityKw : 0;
          const center: [number, number] = [f.location.lat, f.location.lng];
          return (
            <Fragment key={f._id}>
              <Circle
                center={center}
                radius={400}
                pathOptions={{ color, fillColor: color, fillOpacity: 0.45, weight: 2 }}
              />
              <CircleMarker
                center={center}
                radius={5}
                pathOptions={{ color: "#1a202c", fillColor: color, fillOpacity: 1, weight: 2 }}
              >
                <Tooltip permanent direction="top" offset={[0, -6]}>
                  <span className="text-xs font-semibold">{f.code}</span>
                </Tooltip>
                <Popup>
                  <div className="space-y-1 text-sm">
                    <div className="font-semibold">{f.name}</div>
                    <div>
                      Available surplus:{" "}
                      <span className="font-semibold text-green-700">
                        {f.availableSurplusKwh.toFixed(1)} / {f.capacityKw} kWh
                      </span>
                    </div>
                    <div>Utilisation: {(util * 100).toFixed(1)}%</div>
                    <div>Solar output: {f.currentLoadKw.toFixed(1)} kW</div>
                    <div className="capitalize">
                      Congestion: <span style={{ color }}>{CONGESTION_LABEL[level]}</span>
                    </div>
                  </div>
                </Popup>
              </CircleMarker>
            </Fragment>
          );
        })}
      </MapContainer>
    </div>
  );
}
