export function KnowledgeGraph({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (name: string) => void;
}) {
  const points = [
    { x: 240, y: 355, r: 38, name: "大数据基础概念", group: true },
    { x: 174, y: 237, r: 24, name: "大数据基本概念" },
    { x: 112, y: 378, r: 24, name: "大数据技术与模型" },
    { x: 220, y: 487, r: 24, name: "大数据特征与类型" },
    { x: 386, y: 328, r: 30, name: "大数据生命周期与应用", group: true },
    { x: 356, y: 194, r: 20, name: "大数据生命周期" },
    { x: 483, y: 233, r: 15, name: "大数据驱动因素" },
    { x: 511, y: 373, r: 15, name: "DIKW金字塔模型" },
    { x: 408, y: 461, r: 15, name: "商务智能的发展过程" },
  ];
  return (
    <div className="home-graph-canvas">
      <svg
        viewBox="0 0 648 719"
        role="img"
        aria-label="课程章节与知识点关系图"
        style={{ width: "100%", height: "100%", minHeight: 470 }}
      >
        <defs>
          <filter id="graphShadow">
            <feDropShadow
              dx="0"
              dy="3"
              stdDeviation="6"
              floodColor="#3b82f6"
              floodOpacity=".18"
            />
          </filter>
        </defs>
        {points.slice(1).map((p, i) => (
          <line
            key={p.name}
            x1={i < 4 ? 240 : 386}
            y1={i < 4 ? 355 : 328}
            x2={p.x}
            y2={p.y}
            stroke="#e5eaf1"
          />
        ))}
        {points.map((p) => (
          <g
            key={p.name}
            role="button"
            tabIndex={0}
            aria-label={p.name}
            onClick={() => onSelect(p.name)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSelect(p.name);
            }}
            style={{ cursor: "pointer" }}
          >
            <circle
              cx={p.x}
              cy={p.y}
              r={p.r}
              fill={
                selected === p.name
                  ? "#2563eb"
                  : p.group
                    ? "#d1fae5"
                    : p.r > 20
                      ? "#60a5fa"
                      : "#f8fafc"
              }
              stroke={
                p.group || selected === p.name
                  ? "#10b981"
                  : p.r > 20
                    ? "#3b82f6"
                    : "#94a3b8"
              }
              strokeWidth={p.group || selected === p.name ? 5 : 2}
              filter="url(#graphShadow)"
            />
            <text
              x={p.x + p.r + 7}
              y={p.y + 4}
              fill={selected === p.name ? "#2563eb" : "#475569"}
              fontSize={p.group ? 13 : 11}
              fontWeight={p.group ? 700 : 400}
            >
              {p.name}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
export function StudentChart({ kind }: { kind: "radar" | "trend" }) {
  if (kind === "radar") {
    const names = [
      "知识掌握",
      "测验表现",
      "学习稳定性",
      "实践能力",
      "学习投入",
    ];
    const values = [0.545, 0.484, 0.861, 0.64, 0.693];
    const p = (i: number, r: number) => [
      250 + Math.sin((i * Math.PI * 2) / 5) * r,
      210 - Math.cos((i * Math.PI * 2) / 5) * r,
    ];
    return (
      <div className="chart-box">
        <svg
          viewBox="0 0 500 420"
          style={{ width: "100%", height: "100%" }}
          role="img"
          aria-label="五维能力雷达图"
        >
          {[1, 0.8, 0.6, 0.4, 0.2].map((r) => (
            <polygon
              key={r}
              points={names.map((_, i) => p(i, r * 150).join(",")).join(" ")}
              fill={r % 0.4 === 0 ? "#f1f5ff" : "#f8faff"}
              stroke="#e2e8f0"
            />
          ))}
          {names.map((n, i) => {
            const [x, y] = p(i, 177);
            const [ex, ey] = p(i, 150);
            return (
              <g key={n}>
                <line x1={250} y1={210} x2={ex} y2={ey} stroke="#e2e8f0" />
                <text
                  x={x}
                  y={y}
                  fontSize={12}
                  fill="#475569"
                  textAnchor="middle"
                >
                  {n}
                </text>
              </g>
            );
          })}
          <polygon
            points={values.map((r, i) => p(i, r * 150).join(",")).join(" ")}
            fill="#6288ff33"
            stroke="#5d83ff"
            strokeWidth={2}
          />
          {values.map((r, i) => {
            const [x, y] = p(i, r * 150);
            return <circle key={i} cx={x} cy={y} r={3} fill="#547bff" />;
          })}
        </svg>
      </div>
    );
  }
  return (
    <div className="chart-box">
      <svg
        viewBox="0 0 600 420"
        preserveAspectRatio="none"
        style={{ width: "100%", height: "100%" }}
        role="img"
        aria-label="近30天学习掌握度变化曲线"
      >
        {[0, 20, 40, 60, 80, 100].map((v) => (
          <g key={v}>
            <line
              x1="45"
              x2="580"
              y1={400 - v * 3.75}
              y2={400 - v * 3.75}
              stroke="#e8edf3"
            />
            <text
              x="30"
              y={404 - v * 3.75}
              textAnchor="end"
              fontSize="11"
              fill="#8291a5"
            >
              {v}
            </text>
          </g>
        ))}
        <g transform="translate(0 -20.4545) scale(1 1.13636)">
          <path
            d="M45 222 C70 190 86 175 108 214 S136 180 158 182 S220 216 246 204 S273 188 302 200 S338 184 367 192 S405 202 441 195 S488 180 514 184 L580 184 L580 370 L45 370Z"
            fill="#168a8020"
          />
          <path
            d="M45 222 C70 190 86 175 108 214 S136 180 158 182 S220 216 246 204 S273 188 302 200 S338 184 367 192 S405 202 441 195 S488 180 514 184 L580 184"
            fill="none"
            stroke="#168a80"
            strokeWidth="2.5"
          />
        </g>
        {[
          "09-28",
          "09-30",
          "10-02",
          "10-04",
          "10-06",
          "10-08",
          "10-10",
          "10-21",
        ].map((t, i) => (
          <text
            key={t}
            x={45 + i * 76}
            y="415"
            textAnchor="middle"
            fontSize="10"
            fill="#8291a5"
          >
            2026-{t}
          </text>
        ))}
      </svg>
    </div>
  );
}
