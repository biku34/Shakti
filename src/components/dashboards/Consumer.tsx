"use client";

/**
 * Consumer role is deprecated — trading is unified onto the single prosumer
 * (trader) dashboard, where a user both buys and sells energy. This re-export
 * keeps any legacy `consumer` account rendering the same trading dashboard.
 */
export { default } from "@/components/dashboards/Prosumer";
