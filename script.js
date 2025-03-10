// Declare global variables
const updateDate = "March 10, 2025";
const activityLevel = 2; // 1=Low; 2=Moderate; 3=High
const activityTrend = 1; // 1=Decrease; 2=Same; 3=Increase

// On page load, update dynamic content
document.addEventListener("DOMContentLoaded", function () {
  // Update the text containing the date
  document.getElementById("update-date").textContent = updateDate;

  // Update the activity trend information
  const trendButton = document.getElementById("trendButton");
  switch (activityTrend) {
    case 1:
      trendButton.textContent = "📉 Decreasing";
      trendButton.style.backgroundColor = "#D0FBE0";
      break;
    case 2:
      trendButton.textContent = "➖ Staying the Same";
      trendButton.style.backgroundColor = "#FFE599";
      break;
    case 3:
      trendButton.textContent = "📈 Increasing";
      trendButton.style.backgroundColor = "#FF9999";
      break;
  }

  // Update the activity level text
  const textElement = document.getElementById("activityText");
  switch (activityLevel) {
    case 1:
      textElement.style = "color: #00D26A;";
      textElement.textContent = "Low";
      break;
    case 2:
      textElement.style = "color: #FCD53F;";
      textElement.textContent = "Moderate";
      break;
    case 3:
      textElement.style = "color: #F8312F;";
      textElement.textContent = "High";
      break;
  }

  // Update gauge chart and activity text
  gaugeChart.update();
});

const gaugeData = {
  labels: ["Low", "Moderate", "High"],
  datasets: [
    {
      label: "Risk Level",
      data: [20, 20, 20],
      backgroundColor: [
        "#00D26A", // Green for Low
        "#FCD53F", // Yellow for Moderate
        "#F8312F", // Red for High
      ],
      borderColor: ["#000000", "#000000", "#000000"],
      borderWidth: 2,
      circumference: 180,
      rotation: 270,
      borderRadius: 10,
    },
  ],
};

// Custom plugin to draw the needle
const gaugeNeedle = {
  id: "gaugeNeedle",
  afterDatasetsDraw(chart, args, options) {
    const { ctx } = chart;

    // Use a switch to set the needle angle
    switch (activityLevel) {
      case 1:
        angleInDegrees = -60;
        break;
      case 2:
        angleInDegrees = 0;
        break;
      case 3:
        angleInDegrees = 60;
        break;
    }

    const meta = chart.getDatasetMeta(0);
    if (!meta.data || meta.data.length === 0) return;
    const firstArc = meta.data[0];
    const xCenter = firstArc.x;
    const yCenter = firstArc.y;
    const outerRadius = firstArc.outerRadius - 6;
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

const gaugeChart = new Chart(
  document.getElementById("doughnutChart"),
  gaugeConfig
);
