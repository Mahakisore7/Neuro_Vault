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
          background: "#4F3DC6",
          borderRadius: 7,
        }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <circle cx="6" cy="6" r="2.5" fill="white" />
          <circle cx="18" cy="6" r="2.5" fill="white" />
          <circle cx="12" cy="18" r="2.5" fill="white" />
          <path
            d="M8 7 L11 16 M16 7 L13 16 M8.5 6 L15.5 6"
            stroke="white"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      </div>
    ),
    { ...size },
  );
}
