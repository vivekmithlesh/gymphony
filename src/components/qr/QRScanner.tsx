import { useEffect, useId, useRef } from "react";
import { Html5Qrcode } from "html5-qrcode";

interface QRScannerProps {
  /** Fires once per distinct decode (repeated frame-reads of the same code are collapsed). */
  onDecode: (text: string) => void;
  /** Fires if the camera can't be started (permission denied, no device, non-HTTPS). */
  onError?: (message: string) => void;
  className?: string;
  fps?: number;
  qrbox?: number;
}

/**
 * Reusable camera QR scanner — one place that owns the html5-qrcode lifecycle,
 * the back-camera preference, permission-failure reporting and the per-frame
 * decode de-bounce. Mounting it starts the camera; unmounting stops & clears it
 * (html5-qrcode must be stopped before its DOM node is removed). Remount it
 * (e.g. via a changing `key`) to retry after a camera error.
 *
 * Client-only: the camera is only ever touched inside an effect, so it is safe
 * under SSR.
 */
export function QRScanner({ onDecode, onError, className, fps = 10, qrbox = 250 }: QRScannerProps) {
  // useId can contain ':' which is awkward as a DOM id — strip it.
  const elementId = `qr-reader-${useId().replace(/:/g, "")}`;
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const onDecodeRef = useRef(onDecode);
  const onErrorRef = useRef(onError);
  const lastRef = useRef<{ text: string; at: number }>({ text: "", at: 0 });

  // Keep the latest callbacks without restarting the camera.
  useEffect(() => {
    onDecodeRef.current = onDecode;
    onErrorRef.current = onError;
  });

  useEffect(() => {
    let cancelled = false;
    // Defer one tick so the target element is mounted before html5-qrcode binds.
    const timer = setTimeout(async () => {
      if (scannerRef.current || cancelled) return;
      try {
        const scanner = new Html5Qrcode(elementId);
        scannerRef.current = scanner;
        await scanner.start(
          { facingMode: "environment" },
          { fps, qrbox: { width: qrbox, height: qrbox }, aspectRatio: 1.0 },
          (decodedText) => {
            const now = Date.now();
            // Collapse the ~fps repeated reads of the same visible code.
            if (decodedText === lastRef.current.text && now - lastRef.current.at < 1500) return;
            lastRef.current = { text: decodedText, at: now };
            onDecodeRef.current(decodedText);
          },
          () => {
            /* per-frame "not found" noise — ignore */
          },
        );
      } catch {
        scannerRef.current = null;
        if (!cancelled) {
          onErrorRef.current?.(
            "Could not access the camera. Allow camera access (HTTPS is required), then retry.",
          );
        }
      }
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      const s = scannerRef.current;
      scannerRef.current = null;
      if (s) {
        s.stop()
          .then(() => s.clear())
          .catch(() => {});
      }
    };
  }, [elementId, fps, qrbox]);

  return <div id={elementId} className={className} />;
}

export default QRScanner;
