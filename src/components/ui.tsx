"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";

// ─── Data hooks ──────────────────────────────────────────────────────
/** Fetch + optionally poll an API path. Returns data, loading, error, refetch. */
export function useApi<T>(path: string | null, pollMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!path) return;
    try {
      const d = await api<T>(path);
      setData(d);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    load();
    if (!pollMs || !path) return;
    const id = setInterval(load, pollMs);
    return () => clearInterval(id);
  }, [load, pollMs, path]);

  return { data, error, loading, refetch: load };
}

// ─── Layout primitives ───────────────────────────────────────────────
export function Card({
  title,
  actions,
  children,
  className = "",
}: {
  title?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-neutral-200 bg-white p-5 shadow-sm ${className}`}>
      {(title || actions) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title && <h3 className="text-sm font-semibold text-neutral-700">{title}</h3>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({
  label,
  value,
  unit,
  accent = "neutral",
}: {
  label: string;
  value: React.ReactNode;
  unit?: string;
  accent?: "neutral" | "leaf" | "solar" | "grid" | "red";
}) {
  const color = {
    neutral: "text-neutral-900",
    leaf: "text-leaf",
    solar: "text-solar",
    grid: "text-grid",
    red: "text-red-600",
  }[accent];
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-neutral-400">{label}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${color}`}>
        {value}
        {unit && <span className="ml-1 text-sm font-medium text-neutral-400">{unit}</span>}
      </div>
    </div>
  );
}

export function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: string }) {
  const tones: Record<string, string> = {
    neutral: "bg-neutral-100 text-neutral-700",
    green: "bg-green-100 text-green-800",
    yellow: "bg-amber-100 text-amber-800",
    red: "bg-red-100 text-red-800",
    orange: "bg-orange-100 text-orange-800",
    blue: "bg-blue-100 text-blue-800",
    purple: "bg-purple-100 text-purple-800",
  };
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone] ?? tones.neutral}`}>
      {children}
    </span>
  );
}

const STATUS_TONE: Record<string, string> = {
  open: "blue",
  partial: "yellow",
  filled: "green",
  settled: "green",
  matched: "blue",
  issued: "green",
  pending: "yellow",
  transferred: "blue",
  retired: "neutral",
  revoked: "red",
  failed: "red",
  cancelled: "neutral",
  expired: "neutral",
  confirmed: "red",
  flagged: "red",
  investigating: "yellow",
  dismissed: "neutral",
  low: "green",
  medium: "yellow",
  risky: "orange",
  high: "red",
  critical: "red",
  online: "green",
  offline: "red",
};
export function StatusBadge({ value, label }: { value: string; label?: string }) {
  return <Badge tone={STATUS_TONE[value] ?? "neutral"}>{label ?? value}</Badge>;
}

export function Btn({
  children,
  onClick,
  variant = "primary",
  type = "button",
  disabled,
  size = "md",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost" | "danger";
  type?: "button" | "submit";
  disabled?: boolean;
  size?: "sm" | "md";
}) {
  const base =
    "inline-flex items-center justify-center rounded-lg font-medium transition disabled:opacity-50 disabled:cursor-not-allowed";
  const sizes = { sm: "px-2.5 py-1 text-xs", md: "px-4 py-2 text-sm" }[size];
  const variants = {
    primary: "bg-leaf text-white hover:bg-green-700",
    ghost: "border border-neutral-300 text-neutral-700 hover:bg-neutral-50",
    danger: "bg-red-600 text-white hover:bg-red-700",
  }[variant];
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`${base} ${sizes} ${variants}`}>
      {children}
    </button>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-neutral-500">{label}</span>
      {children}
    </label>
  );
}

export const inputClass =
  "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-leaf focus:outline-none focus:ring-1 focus:ring-leaf";

export function Table({
  head,
  children,
  empty = "No data yet.",
  rows,
}: {
  head: string[];
  children?: React.ReactNode;
  empty?: string;
  rows: number;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-full text-left text-sm">
        <thead>
          <tr className="border-b border-neutral-200 text-xs uppercase tracking-wide text-neutral-400">
            {head.map((h) => (
              <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">{children}</tbody>
      </table>
      {rows === 0 && <p className="px-3 py-6 text-center text-sm text-neutral-400">{empty}</p>}
    </div>
  );
}

export function Td({
  children,
  className = "",
  title,
}: {
  children: React.ReactNode;
  className?: string;
  title?: string;
}) {
  return <td title={title} className={`whitespace-nowrap px-3 py-2 ${className}`}>{children}</td>;
}

// ─── Tabs ────────────────────────────────────────────────────────────
export function Tabs({
  tabs,
  children,
  sidebar = false,
}: {
  tabs: { id: string; label: string; icon?: React.ReactNode }[];
  children: (active: string, setActive: (id: string) => void) => React.ReactNode;
  sidebar?: boolean;
}) {
  const [active, setActive] = useState(tabs[0]?.id);

  if (sidebar) {
    // Full-height left nav rail + main content on the right (CRM-style shell).
    // The rail bleeds out of the padded <main> to sit flush against the edge.
    return (
      <div className="flex flex-col lg:-my-6 lg:flex-row lg:items-stretch lg:gap-0">
        {/* Desktop rail */}
        <aside className="sticky top-[53px] z-10 hidden shrink-0 self-start border-r border-neutral-200 bg-white lg:-ml-8 lg:block lg:h-[calc(100vh-53px)] lg:w-60">
          <nav className="flex h-full flex-col gap-1 px-3 py-6">
            <div className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">Menu</div>
            {tabs.map((t) => {
              const on = active === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setActive(t.id)}
                  className={`group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                    on
                      ? "bg-leaf/10 text-leaf ring-1 ring-leaf/20"
                      : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
                  }`}
                >
                  {t.icon && (
                    <span className={on ? "text-leaf" : "text-neutral-400 group-hover:text-neutral-600"}>{t.icon}</span>
                  )}
                  <span>{t.label}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Mobile top bar (rail collapses to horizontal pills) */}
        <div className="mb-6 flex lg:hidden">
          <div className="inline-flex max-w-full gap-1 overflow-x-auto rounded-xl border border-neutral-200 bg-neutral-100/70 p-1 shadow-sm">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setActive(t.id)}
                className={`flex items-center gap-2 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition ${
                  active === t.id
                    ? "bg-white text-neutral-900 shadow-sm ring-1 ring-black/5"
                    : "text-neutral-500 hover:text-neutral-800"
                }`}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="min-w-0 flex-1 lg:py-6 lg:pl-8">{children(active, setActive)}</div>
      </div>
    );
  }

  return (
    <div>
      {/* Enterprise segmented tab bar — single line, horizontally scrollable */}
      <div className="mb-6 flex">
        <div className="inline-flex max-w-full gap-1 overflow-x-auto rounded-xl border border-neutral-200 bg-neutral-100/70 p-1 shadow-sm">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setActive(t.id)}
              className={`whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition ${
                active === t.id
                  ? "bg-white text-neutral-900 shadow-sm ring-1 ring-black/5"
                  : "text-neutral-500 hover:text-neutral-800"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="min-w-0">{children(active, setActive)}</div>
    </div>
  );
}

export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
      {error}
    </div>
  );
}

export function TxLink({ hash }: { hash?: string | null }) {
  if (!hash) return <span className="text-neutral-300">—</span>;
  const short = `${hash.slice(0, 8)}…${hash.slice(-6)}`;
  // Amoy explorer; harmless if the hash is a mock (BLOCKCHAIN_MOCK).
  return (
    <a
      href={`https://amoy.polygonscan.com/tx/${hash}`}
      target="_blank"
      rel="noopener noreferrer"
      className="font-mono text-xs text-grid hover:underline"
      title={hash}
    >
      🔗 {short}
    </a>
  );
}

export function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const show = useCallback((m: string) => {
    setMsg(m);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(null), 3500);
  }, []);
  const node = msg ? (
    <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-neutral-900 px-4 py-2 text-sm text-white shadow-lg">
      {msg}
    </div>
  ) : null;
  return { show, node };
}
