import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          // Satori (which ImageResponse uses to rasterize this) only
          // understands hex/rgb/hsl/named colors, not oklch() — this is the
          // same indigo as --primary in globals.css, just in a syntax it
          // can parse.
          background: "#4157D6",
          borderRadius: 7,
        }}
      >
        <svg width="23" height="23" viewBox="0 0 24 24" fill="none">
          {/* Same glyph as components/logo.tsx. */}
          <path
            d="M6.5 8 L17.5 6.5 M6.5 8 L12 18 M17.5 6.5 L12 18"
            stroke="white"
            strokeOpacity="0.6"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <circle cx="6.5" cy="8" r="2.6" fill="white" />
          <circle cx="17.5" cy="6.5" r="2.2" fill="white" />
          <circle cx="12" cy="18" r="3" fill="white" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
