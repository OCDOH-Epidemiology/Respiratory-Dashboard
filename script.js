// ----------------------------
// Auto-populate defaults using current date
// ----------------------------
const now = new Date();
const monthNames = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];
const defaultMonth = monthNames[now.getMonth()];
const defaultYear = now.getFullYear();
// Use current day as default; if you prefer it to be empty, you can set it to ""
const defaultDay = now.getDate().toString();

// 1. Read values from localStorage (or use defaults if nothing is set)
let storedNeedlePosition = localStorage.getItem("needlePosition") || "high";
let storedHeaderMonth = localStorage.getItem("headerMonth") || defaultMonth;
let storedHeaderDay = localStorage.getItem("headerDay") || defaultDay;
let storedHeaderYear = localStorage.getItem("headerYear") || defaultYear;
let storedTrendAnalysis = localStorage.getItem("trendAnalysis") || "increasing";

// 2. Convert the needle position to a numeric activity level
//    (1 = Low, 2 = Moderate, 3 = High)
let activityLevel;
switch (storedNeedlePosition.toLowerCase()) {
  case "low":
    activityLevel = 1;
    break;
  case "moderate":
    activityLevel = 2;
    break;
  case "high":
  default:
    activityLevel = 3;
    break;
}

// 3. Convert the trend analysis string to a numeric value
//    (1 = Decreasing, 2 = Staying the Same, 3 = Increasing)
let activityTrend;
switch (storedTrendAnalysis.toLowerCase()) {
  case "decreasing":
    activityTrend = 1;
    break;
  case "staying the same":
    activityTrend = 2;
    break;
  case "increasing":
  default:
    activityTrend = 3;
    break;
}

// 4. Combine header date parts into a single string
let updateDate = `${storedHeaderMonth} ${storedHeaderDay}, ${storedHeaderYear}`;

// 5. Expose these values as globals so that the gauge plugin can access them.
window.activityLevel = activityLevel;
window.activityTrend = activityTrend;
window.updateDate = updateDate;

//
// DOMContentLoaded – Update the page elements with these values
//
document.addEventListener("DOMContentLoaded", function () {
  // Update the header date text
  document.getElementById("update-date").textContent = updateDate;

  // Update the Trend Analysis button
  const trendButton = document.getElementById("trendButton");
  if (activityTrend === 1) {
    trendButton.textContent = "📉 Decreasing";
    trendButton.style.backgroundColor = "#D0FBE0";
  } else if (activityTrend === 2) {
    trendButton.textContent = "➖ Staying the Same";
    trendButton.style.backgroundColor = "#FFE599";
  } else if (activityTrend === 3) {
    trendButton.textContent = "📈 Increasing";
    trendButton.style.backgroundColor = "#FF9999";
  }

  // Update the activity level text below the gauge
  const activityText = document.getElementById("activityText");
  if (activityLevel === 1) {
    activityText.style.color = "#00D26A";
    activityText.textContent = "Low";
  } else if (activityLevel === 2) {
    activityText.style.color = "#FCD53F";
    activityText.textContent = "Moderate";
  } else if (activityLevel === 3) {
    activityText.style.color = "#F8312F";
    activityText.textContent = "High";
  }

  // Update the gauge chart (if already created)
  if (typeof gaugeChart !== "undefined") {
    gaugeChart.update();
  }
});

//
// Set up the gauge chart (using Chart.js)
//
const gaugeData = {
  labels: ["Low", "Moderate", "High"],
  datasets: [
    {
      label: "Risk Level",
      data: [20, 20, 20],
      backgroundColor: ["#00D26A", "#FCD53F", "#F8312F"],
      borderColor: ["#000000", "#000000", "#000000"],
      borderWidth: 2,
      circumference: 180,
      rotation: 270,
      borderRadius: 10,
    },
  ],
};

// Custom plugin to draw the needle based on activityLevel
const gaugeNeedle = {
  id: "gaugeNeedle",
  afterDatasetsDraw(chart, args, options) {
    const { ctx } = chart;
    let angleInDegrees;
    // Use the global activityLevel value to determine the needle angle
    switch (window.activityLevel) {
      case 1:
        angleInDegrees = -60;
        break;
      case 2:
        angleInDegrees = 0;
        break;
      case 3:
      default:
        angleInDegrees = 60;
        break;
    }
    // Get center coordinates and radius from the first arc
    const meta = chart.getDatasetMeta(0);
    if (!meta.data || meta.data.length === 0) return;
    const firstArc = meta.data[0];
    const xCenter = firstArc.x;
    const yCenter = firstArc.y;
    const outerRadius = firstArc.outerRadius - 6;

    // Draw the needle
    ctx.save();
    ctx.translate(xCenter, yCenter);
    ctx.rotate((angleInDegrees * Math.PI) / 180);
    ctx.beginPath();
    ctx.moveTo(-5, 0);
    ctx.lineTo(0, -outerRadius);
    ctx.lineTo(5, 0);
    ctx.fillStyle = "black";
    ctx.fill();
    ctx.strokeStyle = "black";
    ctx.stroke();
    // Draw a center circle on the needle pivot
    ctx.beginPath();
    ctx.arc(0, 0, 10, 0, 2 * Math.PI, false);
    ctx.fill();
    ctx.restore();
  },
};

const gaugeConfig = {
  type: "doughnut",
  data: gaugeData,
  options: {
    aspectRatio: 1.5,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          title: () => "",
          label: (context) => context.label,
        },
      },
    },
  },
  plugins: [gaugeNeedle],
};

// Create the Chart.js gauge chart
const gaugeChart = new Chart(
  document.getElementById("doughnutChart"),
  gaugeConfig
);
