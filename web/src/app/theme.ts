import { theme as antdTheme } from "antd";
import type { ThemeConfig } from "antd";

/*
 * HaJi Mark kit「lab」研究工作室 · 高密度工作台
 * Exports: palette / darkPalette / fontFamily / monoFamily / theme / darkTheme / comfortableToken.
 * Keep in sync with web/src/styles/kit.css (:root and [data-theme-mode="dark"]).
 * Semantics: `teal*` keys keep their original names but represent primary (iris violet).
 */
export const palette = {
  ink: "#0b0d12",
  inkSoft: "#3c4149",
  muted: "#6b7280",
  teal: "#5b5bd6",
  tealDeep: "#4c4cc4",
  tealPressed: "#3f3fae",
  tealBright: "#7c7cf0",
  mint: "#eeeefc",
  mintSoft: "#f4f5f7",
  mintLine: "#d4d4f7",
  line: "#e6e8eb",
  canvas: "#f6f7f9",
  surface: "#f8f9fb",
  danger: "#b91c1c",
  warning: "#b45309",
  success: "#15803d",
  // kit extras
  lineStrong: "#d1d5db",
  panel: "#ffffff",
  panel2: "#f3f4f6",
  hover: "#eceef2",
  onPrimary: "#ffffff",
  dangerBg: "#fef2f2",
  dangerLine: "#fecaca",
  warningBg: "#fffbeb",
  warningLine: "#fde68a",
  successBg: "#f0fdf4",
  successLine: "#bbf7d0",
  evidence: "#fef3c7",
  evidenceInk: "#854d0e",
  ai: "#5b5bd6",
  aiAlt: "#0ea5e9",
  aiSoft: "#f1f1fd",
  verdict: "#15803d",
} as const;

type Palette = Record<keyof typeof palette, string>;

export const darkPalette = {
  ink: "#edeef0",
  inkSoft: "#b8bcc4",
  muted: "#9ca3af",
  teal: "#6366f1",
  tealDeep: "#5254e0",
  tealPressed: "#4345c9",
  tealBright: "#818cf8",
  mint: "#1e1f42",
  mintSoft: "#181c26",
  mintLine: "#3b3d7a",
  line: "#252b37",
  canvas: "#0b0d12",
  surface: "#10131a",
  danger: "#f87171",
  warning: "#fbbf24",
  success: "#4ade80",
  lineStrong: "#363e4f",
  panel: "#151922",
  panel2: "#1b202c",
  hover: "#222836",
  onPrimary: "#ffffff",
  dangerBg: "#2a1214",
  dangerLine: "#5c2326",
  warningBg: "#2a1f0a",
  warningLine: "#5c4210",
  successBg: "#0f2418",
  successLine: "#1f4d31",
  evidence: "#3a2e0b",
  evidenceInk: "#fcd34d",
  ai: "#8f8ff5",
  aiAlt: "#38bdf8",
  aiSoft: "#1a1a33",
  verdict: "#4ade80",
} as const satisfies Palette;

export const fontFamily =
  'Inter, "Geist", "PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", "Segoe UI", system-ui, sans-serif';

export const monoFamily =
  '"JetBrains Mono", "Geist Mono", "Cascadia Code", Consolas, ui-monospace, monospace';

function build(p: Palette, dark: boolean): ThemeConfig {
  return {
    token: {
      colorPrimary: p.teal,
      colorPrimaryHover: p.tealDeep,
      colorPrimaryActive: p.tealPressed,
      colorInfo: p.teal,
      colorLink: p.teal,
      colorLinkHover: p.tealDeep,
      colorLinkActive: p.tealPressed,
      colorSuccess: p.success,
      colorSuccessBg: p.successBg,
      colorSuccessBorder: p.successLine,
      colorWarning: p.warning,
      colorWarningBg: p.warningBg,
      colorWarningBorder: p.warningLine,
      colorError: p.danger,
      colorErrorBg: p.dangerBg,
      colorErrorBorder: p.dangerLine,
      colorInfoBg: p.mint,
      colorInfoBorder: p.mintLine,
      colorText: p.ink,
      colorTextSecondary: p.muted,
      colorTextDisabled: dark ? "#64748b" : "#9ca3af",
      colorBgContainerDisabled: dark ? "#1a1f2b" : "#f3f4f6",
      colorBorder: p.lineStrong,
      colorBorderSecondary: p.line,
      colorSplit: p.line,
      colorBgLayout: p.canvas,
      colorBgContainer: p.panel,
      colorBgElevated: dark ? p.panel2 : p.panel,
      colorFillAlter: p.panel2,
      borderRadius: 6,
      borderRadiusXS: 2,
      borderRadiusSM: 4,
      borderRadiusLG: 10,
      controlHeight: 32,
      controlHeightSM: 26,
      controlHeightLG: 38,
      fontSize: 13,
      fontSizeSM: 12,
      fontSizeLG: 14,
      fontSizeHeading1: 24,
      fontSizeHeading2: 20,
      fontSizeHeading3: 16,
      fontSizeHeading4: 14,
      fontSizeHeading5: 13,
      lineHeight: 1.5,
      fontFamily,
      fontFamilyCode: monoFamily,
      boxShadow: dark
        ? "0 8px 24px #00000080, 0 0 0 1px #ffffff0d"
        : "0 4px 12px #0b0d1214, 0 1px 3px #0b0d120f",
      boxShadowSecondary: dark
        ? "0 12px 32px #00000099, 0 0 0 1px #ffffff12"
        : "0 8px 24px #0b0d121a, 0 2px 6px #0b0d120f",
      motionDurationFast: "0.08s",
      motionDurationMid: "0.12s",
      motionDurationSlow: "0.18s",
      wireframe: false,
    },
    components: {
      Button: {
        primaryShadow: "none",
        defaultShadow: "none",
        dangerShadow: "none",
        fontWeight: 500,
        borderRadius: 6,
        paddingInline: 12,
        primaryColor: p.onPrimary,
        defaultBg: p.panel,
        defaultColor: p.ink,
        defaultBorderColor: p.lineStrong,
        defaultHoverBg: p.panel2,
        defaultHoverColor: p.ink,
        defaultHoverBorderColor: p.lineStrong,
      },
      Input: {
        activeShadow: `0 0 0 3px ${p.mint}`,
        activeBorderColor: p.teal,
        hoverBorderColor: p.tealBright,
      },
      InputNumber: {
        activeShadow: `0 0 0 3px ${p.mint}`,
        activeBorderColor: p.teal,
        hoverBorderColor: p.tealBright,
      },
      Select: {
        selectorBg: p.panel,
        clearBg: p.panel,
        optionSelectedBg: p.mint,
        optionSelectedColor: p.ink,
        optionActiveBg: p.panel2,
      },
      Card: {
        borderRadiusLG: 10,
        headerFontSize: 14,
        headerHeight: 44,
        headerHeightSM: 36,
        bodyPadding: 16,
        headerPadding: 16,
      },
      Menu: {
        itemBg: "transparent",
        itemColor: p.inkSoft,
        itemHoverColor: p.ink,
        itemHoverBg: p.hover,
        itemSelectedBg: p.panel,
        itemSelectedColor: p.ink,
        itemActiveBg: p.hover,
        itemBorderRadius: 6,
        itemHeight: 32,
        itemMarginBlock: 2,
        itemMarginInline: 0,
        activeBarBorderWidth: 0,
        groupTitleColor: p.muted,
        groupTitleFontSize: 11,
      },
      Tag: { defaultBg: p.panel2, defaultColor: p.inkSoft },
      Table: {
        headerBg: p.panel2,
        headerColor: p.muted,
        headerSplitColor: "transparent",
        rowHoverBg: p.panel2,
        rowSelectedBg: p.mint,
        rowSelectedHoverBg: p.mint,
        borderColor: p.line,
        cellPaddingBlock: 8,
        cellPaddingInline: 12,
        cellFontSize: 13,
      },
      Tabs: {
        horizontalMargin: "0 0 12px 0",
        horizontalItemPadding: "8px 0",
        titleFontSize: 13,
        inkBarColor: p.teal,
        itemColor: p.muted,
        itemHoverColor: p.ink,
        itemSelectedColor: p.ink,
      },
      Segmented: {
        trackBg: p.panel2,
        itemColor: p.muted,
        itemHoverColor: p.ink,
        itemHoverBg: p.hover,
        itemSelectedBg: p.panel,
        itemSelectedColor: p.ink,
      },
      Statistic: { titleFontSize: 11, contentFontSize: 24 },
      Progress: { defaultColor: p.teal, remainingColor: p.line },
      Collapse: { headerBg: p.panel2, contentBg: p.panel, headerPadding: "8px 12px" },
      Form: { labelFontSize: 13, verticalLabelPadding: "0 0 4px", itemMarginBottom: 16 },
      Alert: { borderRadiusLG: 8 },
      Modal: { contentBg: p.panel, headerBg: p.panel, borderRadiusLG: 12 },
      Drawer: { colorBgElevated: p.panel },
      Pagination: { itemActiveBg: p.mint },
    },
  };
}

export const theme: ThemeConfig = build(palette, false);

export const darkTheme: ThemeConfig = {
  ...build(darkPalette, true),
  algorithm: antdTheme.darkAlgorithm,
};

/** Student / comfortable density token overrides. */
export const comfortableToken: NonNullable<ThemeConfig["token"]> = {
  fontSize: 14,
  controlHeight: 36,
  controlHeightSM: 28,
  controlHeightLG: 40,
};
