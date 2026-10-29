import type { ThemeConfig } from "antd";

export const palette = {
  ink: "#0d2b29",
  inkSoft: "#3d5652",
  muted: "#61736f",
  teal: "#006764",
  tealDeep: "#0b4c48",
  tealBright: "#00938b",
  mint: "#e0f8f0",
  mintSoft: "#f0f8f8",
  mintLine: "#bfe0d9",
  line: "#dbe7e4",
  canvas: "#ffffff",
  danger: "#b42318",
  success: "#027a48",
} as const;

export const theme: ThemeConfig = {
  token: {
    colorPrimary: palette.teal,
    colorInfo: palette.teal,
    colorSuccess: palette.success,
    colorError: palette.danger,
    colorText: palette.ink,
    colorTextSecondary: palette.muted,
    colorBorder: palette.line,
    colorBgLayout: palette.canvas,
    borderRadius: 8,
    controlHeight: 42,
    fontSize: 15,
    fontFamily:
      'Inter, "PingFang SC", "Microsoft YaHei", "Segoe UI", system-ui, sans-serif',
  },
  components: {
    Button: { primaryShadow: "0 3px 5px #003c4426", fontWeight: 500, borderRadius: 8 },
    Input: { activeShadow: `0 0 0 3px ${palette.mint}` },
    Card: { borderRadiusLG: 16 },
  },
};
