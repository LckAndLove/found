import { useState, useRef, MouseEvent } from "react";

// Helper to convert time string "HH:MM" to minute index (0 to 240)
function timeToMinuteIndex(timeStr: string): number {
  const [hourStr, minStr] = timeStr.split(":");
  const hour = parseInt(hourStr || "0", 10);
  const min = parseInt(minStr || "0", 10);

  if (hour < 12) {
    // Morning session starts at 09:30
    const minutes = (hour - 9) * 60 + min - 30;
    return Math.max(0, Math.min(120, minutes));
  } else {
    // Afternoon session starts at 13:00
    const minutes = (hour - 13) * 60 + min + 120;
    return Math.max(120, Math.min(240, minutes));
  }
}

// Helper to format percentage values
function formatPercent(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

interface IntradayPoint {
  time: string;
  value: number;
  growth: string;
}

interface IntradayChartProps {
  data: IntradayPoint[];
  date?: string | null;
}

export function IntradayChart({ data, date }: IntradayChartProps) {
  const [hoveredPoint, setHoveredPoint] = useState<IntradayPoint | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const svgRef = useRef<SVGSVGElement | null>(null);

  if (data.length === 0) {
    return (
      <div className="chart-empty">
        <p>暂无分时估值数据</p>
      </div>
    );
  }

  // Chart configuration
  const width = 600;
  const height = 200;
  const padding = { top: 20, right: 20, bottom: 25, left: 55 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // Extract growth values as numbers
  const points = data.map((item) => ({
    ...item,
    growthVal: parseFloat(item.growth),
    xIndex: timeToMinuteIndex(item.time)
  })).sort((a, b) => a.xIndex - b.xIndex);

  // Find boundaries
  const growths = points.map((p) => p.growthVal);
  const maxAbsGrowth = Math.max(...growths.map(Math.abs), 0.1); // min scale is 0.1%
  const minGrowth = -maxAbsGrowth;
  const maxGrowth = maxAbsGrowth;

  // Coordinate mapping functions
  // X maps minute index (0 to 240) to SVG X coordinate
  const getX = (xIndex: number) => padding.left + (xIndex / 240) * chartWidth;
  // Y maps growth rate to SVG Y coordinate
  const getY = (growth: number) => {
    const scale = (growth - minGrowth) / (maxGrowth - minGrowth);
    return padding.top + chartHeight - scale * chartHeight;
  };

  // Center Y (0.00% growth line)
  const centerY = getY(0);

  // Generate SVG path for the line
  let linePath = "";
  let lastX = getX(0);

  points.forEach((p, idx) => {
    const x = getX(p.xIndex);
    const y = getY(p.growthVal);
    if (idx === 0) {
      linePath += `M ${x} ${y} `;
    } else {
      linePath += `L ${x} ${y} `;
    }
    lastX = x;
  });

  const areaPath = points.length > 0 
    ? `M ${getX(points[0].xIndex)} ${centerY} ` + 
      points.map(p => `L ${getX(p.xIndex)} ${getY(p.growthVal)}`).join(" ") + 
      ` L ${lastX} ${centerY} Z`
    : "";

  // Dynamic color coding based on current gain/loss
  const lastPoint = points[points.length - 1];
  const isUp = lastPoint ? parseFloat(lastPoint.growth) >= 0 : true;
  const strokeColor = isUp ? "var(--color-red)" : "var(--color-green)"; // use CSS variables
  const gradientId = isUp ? "intraday-gradient-up" : "intraday-gradient-down";

  // Handle Mouse Hover
  const handleMouseMove = (e: MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current || points.length === 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    const clientX = e.clientX - rect.left;

    // Convert clientX to SVG viewBox coordinate system
    const svgX = (clientX / rect.width) * width;
    
    // Find closest point by x coordinate
    let closest = points[0];
    let minDiff = Math.abs(getX(closest.xIndex) - svgX);

    points.forEach((p) => {
      const diff = Math.abs(getX(p.xIndex) - svgX);
      if (diff < minDiff) {
        minDiff = diff;
        closest = p;
      }
    });

    setHoveredPoint(closest);
    setTooltipPos({
      x: getX(closest.xIndex),
      y: getY(closest.growthVal)
    });
  };

  const handleMouseLeave = () => {
    setHoveredPoint(null);
  };

  return (
    <div className="chart-container">
      <div className="chart-header-row">
        <h3>分时估值走势 {date ? `(${date})` : "(当日)"}</h3>
        {hoveredPoint && (
          <div className="chart-hover-info">
            <span className="time">{hoveredPoint.time}</span>
            <span className="value">估值: {hoveredPoint.value.toFixed(4)}</span>
            <span className={`growth ${parseFloat(hoveredPoint.growth) >= 0 ? "up" : "down"}`}>
              {formatPercent(parseFloat(hoveredPoint.growth))}
            </span>
          </div>
        )}
      </div>
      <div className="svg-wrapper">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          height="100%"
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        >
          <defs>
            <linearGradient id="intraday-gradient-up" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-red)" stopOpacity="0.16" />
              <stop offset="100%" stopColor="var(--color-red)" stopOpacity="0.00" />
            </linearGradient>
            <linearGradient id="intraday-gradient-down" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-green)" stopOpacity="0.16" />
              <stop offset="100%" stopColor="var(--color-green)" stopOpacity="0.00" />
            </linearGradient>
          </defs>

          {/* Grid lines */}
          <line x1={padding.left} y1={padding.top} x2={width - padding.right} y2={padding.top} stroke="#eef1ed" strokeWidth="1" />
          <line x1={padding.left} y1={padding.top + chartHeight / 2} x2={width - padding.right} y2={padding.top + chartHeight / 2} stroke="#eef1ed" strokeWidth="1" strokeDasharray="3,3" />
          <line x1={padding.left} y1={height - padding.bottom} x2={width - padding.right} y2={height - padding.bottom} stroke="#eef1ed" strokeWidth="1" />

          {/* Reference trading hour vertical lines */}
          {/* 11:30 morning close (minute 120) */}
          <line x1={getX(120)} y1={padding.top} x2={getX(120)} y2={height - padding.bottom} stroke="#eef1ed" strokeWidth="1" strokeDasharray="3,3" />

          {/* Zero center baseline */}
          <line x1={padding.left} y1={centerY} x2={width - padding.right} y2={centerY} stroke="#cbd4cd" strokeWidth="1" />

          {/* Y Axis Labels */}
          <text x={padding.left - 8} y={padding.top + 4} textAnchor="end" fontSize="10" fill="#7a817b" fontWeight="bold">
            {formatPercent(maxGrowth)}
          </text>
          <text x={padding.left - 8} y={centerY + 4} textAnchor="end" fontSize="10" fill="#7a817b">
            0.00%
          </text>
          <text x={padding.left - 8} y={height - padding.bottom + 4} textAnchor="end" fontSize="10" fill="#7a817b" fontWeight="bold">
            {formatPercent(minGrowth)}
          </text>

          {/* X Axis Labels */}
          <text x={getX(0)} y={height - 8} textAnchor="start" fontSize="10" fill="#7a817b">09:30</text>
          <text x={getX(120)} y={height - 8} textAnchor="middle" fontSize="10" fill="#7a817b">11:30/13:00</text>
          <text x={getX(240)} y={height - 8} textAnchor="end" fontSize="10" fill="#7a817b">15:00</text>

          {/* Area Fill */}
          {areaPath && (
            <path d={areaPath} fill={`url(#${gradientId})`} />
          )}

          {/* Line Stroke */}
          {linePath && (
            <path
              d={linePath}
              fill="none"
              stroke={strokeColor}
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Interactive elements */}
          {hoveredPoint && (
            <>
              {/* Vertical line indicator */}
              <line
                x1={tooltipPos.x}
                y1={padding.top}
                x2={tooltipPos.x}
                y2={height - padding.bottom}
                stroke="#cbd4cd"
                strokeWidth="1"
                strokeDasharray="2,2"
              />
              {/* Highlight Circle */}
              <circle
                cx={tooltipPos.x}
                cy={tooltipPos.y}
                r="4.5"
                fill={strokeColor}
                stroke="#ffffff"
                strokeWidth="1.5"
              />
            </>
          )}
        </svg>
      </div>
    </div>
  );
}

interface TrendPoint {
  x: number;
  y: number;
  equityReturn: number | null;
}

interface HistoryTrendChartProps {
  data: TrendPoint[];
}

export function HistoryTrendChart({ data }: HistoryTrendChartProps) {
  const [hoveredPoint, setHoveredPoint] = useState<TrendPoint | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const svgRef = useRef<SVGSVGElement | null>(null);

  if (data.length === 0) {
    return (
      <div className="chart-empty">
        <p>暂无历史趋势数据</p>
      </div>
    );
  }

  // Chart configuration
  const width = 600;
  const height = 200;
  const padding = { top: 20, right: 20, bottom: 25, left: 55 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // Parse and sort points
  const points = [...data].sort((a, b) => a.x - b.x);

  // Extract Y values (net worth returns)
  const yValues = points.map((p) => p.y);
  const minY = Math.min(...yValues);
  const maxY = Math.max(...yValues);
  const rangeY = maxY - minY === 0 ? 1 : maxY - minY;

  // Add a 5% padding to top and bottom bounds
  const adjustedMinY = minY - rangeY * 0.05;
  const adjustedMaxY = maxY + rangeY * 0.05;
  const adjustedRange = adjustedMaxY - adjustedMinY;

  // Coordinate mapping functions
  const getX = (idx: number) => padding.left + (idx / (points.length - 1)) * chartWidth;
  const getY = (val: number) => {
    const scale = (val - adjustedMinY) / adjustedRange;
    return padding.top + chartHeight - scale * chartHeight;
  };

  // Generate SVG path for the line
  let linePath = "";
  let lastX = getX(0);

  points.forEach((p, idx) => {
    const x = getX(idx);
    const y = getY(p.y);
    if (idx === 0) {
      linePath += `M ${x} ${y} `;
    } else {
      linePath += `L ${x} ${y} `;
    }
    lastX = x;
  });

  const areaPath = points.length > 0
    ? `M ${getX(0)} ${height - padding.bottom} ` +
      points.map((p, idx) => `L ${getX(idx)} ${getY(p.y)}`).join(" ") +
      ` L ${lastX} ${height - padding.bottom} Z`
    : "";

  // Date formatter helper (converts timestamp to YYYY-MM-DD)
  const formatDate = (timestamp: number) => {
    const d = new Date(timestamp);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const date = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${date}`;
  };

  // Handle Mouse Hover
  const handleMouseMove = (e: MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current || points.length === 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    const clientX = e.clientX - rect.left;

    // Convert clientX to SVG viewBox coordinate system
    const svgX = (clientX / rect.width) * width;

    // Determine the index of the closest data point
    const ratio = (svgX - padding.left) / chartWidth;
    const rawIdx = ratio * (points.length - 1);
    const closestIdx = Math.max(0, Math.min(points.length - 1, Math.round(rawIdx)));

    const closest = points[closestIdx];
    if (closest) {
      setHoveredPoint(closest);
      setTooltipPos({
        x: getX(closestIdx),
        y: getY(closest.y)
      });
    }
  };

  const handleMouseLeave = () => {
    setHoveredPoint(null);
  };

  const startDateText = formatDate(points[0].x);
  const endDateText = formatDate(points[points.length - 1].x);

  return (
    <div className="chart-container">
      <div className="chart-header-row">
        <h3>近 90 日净值走势</h3>
        {hoveredPoint && (
          <div className="chart-hover-info">
            <span className="time">{formatDate(hoveredPoint.x)}</span>
            <span className="value">单位净值: {hoveredPoint.y.toFixed(4)}</span>
            {hoveredPoint.equityReturn !== null && (
              <span className={`growth ${hoveredPoint.equityReturn >= 0 ? "up" : "down"}`}>
                收益: {formatPercent(hoveredPoint.equityReturn)}
              </span>
            )}
          </div>
        )}
      </div>
      <div className="svg-wrapper">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          height="100%"
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        >
          <defs>
            <linearGradient id="history-gradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#4361ee" stopOpacity="0.18" />
              <stop offset="100%" stopColor="#4361ee" stopOpacity="0.00" />
            </linearGradient>
          </defs>

          {/* Grid lines */}
          <line x1={padding.left} y1={padding.top} x2={width - padding.right} y2={padding.top} stroke="#eef1ed" strokeWidth="1" />
          <line x1={padding.left} y1={padding.top + chartHeight / 2} x2={width - padding.right} y2={padding.top + chartHeight / 2} stroke="#eef1ed" strokeWidth="1" strokeDasharray="3,3" />
          <line x1={padding.left} y1={height - padding.bottom} x2={width - padding.right} y2={height - padding.bottom} stroke="#eef1ed" strokeWidth="1" />

          {/* Y Axis Labels */}
          <text x={padding.left - 8} y={padding.top + 4} textAnchor="end" fontSize="10" fill="#7a817b" fontWeight="bold">
            {adjustedMaxY.toFixed(4)}
          </text>
          <text x={padding.left - 8} y={padding.top + chartHeight / 2 + 4} textAnchor="end" fontSize="10" fill="#7a817b">
            {((adjustedMaxY + adjustedMinY) / 2).toFixed(4)}
          </text>
          <text x={padding.left - 8} y={height - padding.bottom + 4} textAnchor="end" fontSize="10" fill="#7a817b" fontWeight="bold">
            {adjustedMinY.toFixed(4)}
          </text>

          {/* X Axis Labels */}
          <text x={getX(0)} y={height - 8} textAnchor="start" fontSize="10" fill="#7a817b">{startDateText}</text>
          <text x={getX(points.length - 1)} y={height - 8} textAnchor="end" fontSize="10" fill="#7a817b">{endDateText}</text>

          {/* Area Fill */}
          {areaPath && (
            <path d={areaPath} fill="url(#history-gradient)" />
          )}

          {/* Line Stroke */}
          {linePath && (
            <path
              d={linePath}
              fill="none"
              stroke="#4361ee"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Interactive hover elements */}
          {hoveredPoint && (
            <>
              {/* Vertical line indicator */}
              <line
                x1={tooltipPos.x}
                y1={padding.top}
                x2={tooltipPos.x}
                y2={height - padding.bottom}
                stroke="#cbd4cd"
                strokeWidth="1"
                strokeDasharray="2,2"
              />
              {/* Highlight Circle */}
              <circle
                cx={tooltipPos.x}
                cy={tooltipPos.y}
                r="4.5"
                fill="#4361ee"
                stroke="#ffffff"
                strokeWidth="1.5"
              />
            </>
          )}
        </svg>
      </div>
    </div>
  );
}
