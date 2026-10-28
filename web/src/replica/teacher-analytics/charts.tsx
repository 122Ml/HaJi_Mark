const colors = ["#22c55e", "#3b82f6", "#ef4444"];
export function DonutChart() {
  const values = [58, 53, 9];
  let offset = 0;
  return (
    <svg
      className="analytics-svg"
      viewBox="0 0 635 420"
      role="img"
      aria-label="掌握度分布：优秀58人，良好53人，待提升9人"
    >
      <g transform="translate(317,210) rotate(-90)">
        {values.map((n, i) => {
          const start = offset;
          offset += (n / 120) * 100;
          return (
            <circle
              key={i}
              r="117"
              fill="none"
              stroke={colors[i]}
              strokeWidth="59"
              pathLength="100"
              strokeDasharray={`${(n / 120) * 100} ${100 - (n / 120) * 100}`}
              strokeDashoffset={-start}
            />
          );
        })}
      </g>
      <g fill="#526078" fontSize="12">
        <text x="498" y="197">
          优秀（≥80）
        </text>
        <text x="498" y="211">
          58人
        </text>
        <path d="M465 201h25" stroke={colors[0]} />
        <text x="62" y="250">
          良好（60-79）
        </text>
        <text x="118" y="265">
          53人
        </text>
        <path d="M171 253l15-3" stroke={colors[1]} />
        <text x="180" y="47">
          待提升（&lt;60）
        </text>
        <text x="228" y="61">
          9人
        </text>
      </g>
      <g transform="translate(137,396)" fontSize="11" fill="#52525b">
        {["优秀（≥80）", "良好（60-79）", "待提升（<60）"].map((n, i) => (
          <g key={n} transform={`translate(${i * 126},0)`}>
            <rect width="22" height="13" rx="2" fill={colors[i]} />
            <text x="28" y="11">
              {n}
            </text>
          </g>
        ))}
      </g>
    </svg>
  );
}
const labels = [
  "日志数据清洗",
  "Kafka 数据接入",
  "欧几里得距离",
  "TensorFlow2...",
  "激活函数",
  "深度学习技术",
  "权重和偏置",
  "流处理计算模型",
  "特征值和特征向量",
  "卷积神经网络",
  "主成分分析(PCA)",
  "TensorFlow架...",
  "深度学习算法",
  "均值计算",
  "奇异值分解(SVD)",
  "深度学习",
  "降维与矩阵分解",
  "软间隔分类器",
  "数据挖掘算法",
  "聚类算法",
];
export function BarChart({
  participation = false,
}: {
  participation?: boolean;
}) {
  return (
    <svg
      className="analytics-svg"
      viewBox="0 0 635 520"
      role="img"
      aria-label={participation ? "知识点学习人数" : "薄弱知识点掌握度"}
    >
      <g fontSize="11" fill="#71717a">
        {[0, 20, 40, 60, 75].map((v, i) => (
          <g key={v}>
            <path stroke="#e4e7ed" d={`M${150 + v * 5.7} 24v460`} />
            <text x={150 + v * 5.7} y="505" textAnchor="middle">
              {participation ? Math.round(v * 1.6) : v + "%"}
            </text>
          </g>
        ))}
        {labels.map((n, i) => {
          const value =
            i === 0 ? 65.54 : i === 1 ? 66.93 : 73.08 + (i - 2) * 0.064;
          return (
            <g key={n} transform={`translate(0,${26 + i * 23})`}>
              <text x="143" y="13" textAnchor="end">
                {n}
              </text>
              <rect
                x="150"
                width={value * 5.7}
                height="16"
                rx="8"
                fill={participation ? "#34b5ac" : "#5279ff"}
              />
              <text x={155 + value * 5.7} y="13" fontSize="10">
                {participation ? 120 - i : value.toFixed(2) + "%"}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}
export function RadarChart({
  values = [75.22, 83.6, 79.75, 67.02, 89.1, 81.78],
}: {
  values?: number[];
}) {
  const labels = [
    "专业投入",
    "数字资源",
    "教学与学习",
    "评估",
    "赋能学习者",
    "促进学习者数字能力",
  ];
  const point = (i: number, v: number) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 3;
    return `${300 + Math.cos(a) * v * 1.5},${220 + Math.sin(a) * v * 1.5}`;
  };
  return (
    <svg
      className="analytics-svg"
      viewBox="0 0 600 440"
      role="img"
      aria-label="教师数字能力六维雷达图"
    >
      {[20, 40, 60, 80, 100].map((n) => (
        <polygon
          key={n}
          points={labels.map((_, i) => point(i, n)).join(" ")}
          fill={n % 40 ? "#fafbff" : "#f4f7ff"}
          stroke="#dfe5ee"
        />
      ))}
      {labels.map((n, i) => (
        <g key={n}>
          <path
            d={`M300 220L${point(i, 100).replace(",", " ")}`}
            stroke="#dfe5ee"
          />
          <text
            x={300 + Math.cos(-Math.PI / 2 + (i * Math.PI) / 3) * 185}
            y={225 + Math.sin(-Math.PI / 2 + (i * Math.PI) / 3) * 185}
            fill="#64748b"
            fontSize="13"
            textAnchor="middle"
          >
            {n}
          </text>
        </g>
      ))}
      <polygon
        points={values.map((v, i) => point(i, v)).join(" ")}
        stroke="#5470c6"
        strokeWidth="2"
        fill="#5470c633"
      />
      {values.map((v, i) => (
        <circle
          key={i}
          cx={point(i, v).split(",")[0]}
          cy={point(i, v).split(",")[1]}
          r="4"
          fill="#5470c6"
        />
      ))}
    </svg>
  );
}
