"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Map as LeafletMap } from "leaflet";
import { decode } from "@/lib/polyline";

/** Interactieve donkere kaart met het Garmin-spoor. De kaart wordt pas geladen
 *  wanneer de activity drawer open is; fitBounds kadert iedere route opnieuw. */
export function RouteTrace({
  polyline,
  height = 200,
  color = "#0093e7",
}: {
  polyline: string;
  height?: number;
  color?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const [ready, setReady] = useState(false);
  const points = useMemo(() => decode(polyline), [polyline]);

  useEffect(() => {
    if (points.length < 2 || !containerRef.current || mapRef.current) return;

    let cancelled = false;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    let animationFrame: number | undefined;
    let observer: ResizeObserver | undefined;

    async function mountMap() {
      const L = await import("leaflet");
      if (cancelled || !containerRef.current) return;

      const map = L.map(containerRef.current, {
        attributionControl: true,
        zoomControl: false,
        scrollWheelZoom: false,
        doubleClickZoom: true,
        touchZoom: true,
        dragging: true,
        keyboard: true,
        preferCanvas: true,
        zoomSnap: 0.25,
      });
      mapRef.current = map;
      map.attributionControl.setPrefix(false);

      L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        {
          subdomains: "abcd",
          maxZoom: 20,
          maxNativeZoom: 20,
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
        },
      ).addTo(map);

      const latLngs = points.map(([lat, lon]) => L.latLng(lat, lon));
      const start = latLngs[0];
      const finish = latLngs.at(-1)!;
      const isLoop = start.distanceTo(finish) < 40;
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      // De volledige vorm blijft zacht zichtbaar als context. De heldere lijn
      // wordt daar vervolgens chronologisch overheen getekend.
      const fullRoute = L.polyline(latLngs, {
        color: "#7ba1bb",
        weight: 3,
        opacity: 0.22,
        lineCap: "round",
        lineJoin: "round",
        interactive: false,
      }).addTo(map);
      const routeHalo = L.polyline(reduceMotion ? latLngs : [start], {
        color: "#101518",
        weight: 8,
        opacity: 0.72,
        lineCap: "round",
        lineJoin: "round",
        interactive: false,
      }).addTo(map);
      const route = L.polyline(reduceMotion ? latLngs : [start], {
        color,
        weight: 4,
        opacity: 1,
        lineCap: "round",
        lineJoin: "round",
        interactive: false,
      }).addTo(map);

      L.circleMarker(start, {
        radius: 6,
        color: "#101518",
        weight: 2,
        fillColor: "#00f19f",
        fillOpacity: 1,
        interactive: false,
      }).addTo(map);
      const finishMarker = L.circleMarker(finish, {
        radius: isLoop ? 7 : 6,
        color: "#ffffff",
        weight: 2,
        opacity: reduceMotion ? 1 : 0,
        fillColor: isLoop ? "#00f19f" : "#101518",
        fillOpacity: reduceMotion ? 1 : 0,
        interactive: false,
      }).addTo(map);
      const positionMarker = reduceMotion
        ? null
        : L.circleMarker(start, {
            radius: 4.5,
            color: "#ffffff",
            weight: 1.5,
            fillColor: color,
            fillOpacity: 1,
            interactive: false,
          }).addTo(map);

      const fitRoute = () => {
        map.invalidateSize({ pan: false });
        map.fitBounds(fullRoute.getBounds(), {
          padding: [26, 26],
          maxZoom: 16,
          animate: false,
        });
      };

      fitRoute();
      settleTimer = setTimeout(fitRoute, 320);
      observer = new ResizeObserver(() => map.invalidateSize({ pan: false }));
      observer.observe(containerRef.current);
      setReady(true);

      if (!reduceMotion && positionMarker) {
        const duration = 2_600;
        const delay = 320;
        let startedAt: number | undefined;

        const drawRoute = (now: number) => {
          if (cancelled) return;
          startedAt ??= now + delay;
          const progress = Math.min(Math.max((now - startedAt) / duration, 0), 1);
          const position = progress * (latLngs.length - 1);
          const index = Math.floor(position);
          const fraction = position - index;
          const visible = latLngs.slice(0, index + 1);
          let current = latLngs[index];

          if (index < latLngs.length - 1 && fraction > 0) {
            const next = latLngs[index + 1];
            current = L.latLng(
              current.lat + (next.lat - current.lat) * fraction,
              current.lng + (next.lng - current.lng) * fraction,
            );
            visible.push(current);
          }

          routeHalo.setLatLngs(visible);
          route.setLatLngs(visible);
          positionMarker.setLatLng(current);

          if (progress < 1) {
            animationFrame = requestAnimationFrame(drawRoute);
          } else {
            positionMarker.remove();
            finishMarker.setStyle({ opacity: 1, fillOpacity: 1 });
          }
        };

        animationFrame = requestAnimationFrame(drawRoute);
      }
    }

    void mountMap();

    return () => {
      cancelled = true;
      if (settleTimer) clearTimeout(settleTimer);
      if (animationFrame) cancelAnimationFrame(animationFrame);
      observer?.disconnect();
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [color, points]);

  if (points.length < 2) return null;

  return (
    <div
      className="route-map row relative isolate overflow-hidden"
      style={{ height }}
      role="region"
      aria-label="Interactieve kaart van de gelopen route"
    >
      <div ref={containerRef} className="absolute inset-0" />
      {!ready ? (
        <div className="absolute inset-0 z-10 grid place-items-center bg-s2 text-[10px] font-semibold text-faint">
          Kaart laden…
        </div>
      ) : null}
    </div>
  );
}
