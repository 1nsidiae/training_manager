"use client";

import * as React from "react";

/** Registreert een minimale service worker. Hij cachet alleen publieke
 * PWA-assets en nooit pagina's of persoonlijke Garmin-gegevens. */
export function PwaRegister() {
  React.useEffect(() => {
    if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
    navigator.serviceWorker.register("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    }).catch(() => {
      // Installatie blijft bruikbaar als webapp; een mislukte registratie hoort
      // de normale app niet te blokkeren.
    });
  }, []);
  return null;
}
