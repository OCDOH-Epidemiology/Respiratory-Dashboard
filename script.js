// Declare global variables
// If you want to override the dynamic date, set updateDateOverride to a string date.
const updateDateOverride = "November 14, 2025";
const activityLevel = 1; // 1=Low; 2=Moderate; 3=High
const activityTrend = 3; // 1=Decrease; 2=Same; 3=Increase

// On page load, update dynamic content
document.addEventListener("DOMContentLoaded", function () {
  // Update the text containing the date
  const dateTarget = document.getElementById("update-date");
  const today = new Date();
  const dynamicDate = today.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  dateTarget.textContent = updateDateOverride || dynamicDate;

  // Update the trend analysis button:
  // Set its text based on the activityTrend value...
  const trendButton = document.getElementById("trendButton");
  trendButton.style.backgroundColor = "transparent"; // Remove outside color for clarity
  trendButton.style.color = "black"; // Keep main text black

  // Only the arrow changes color: green for decreasing, red for increasing; black for same
  switch (activityTrend) {
    case 1: {
      const arrow = '<span style="color:#00D26A">▼</span>';
      trendButton.innerHTML = `${arrow} Decreasing`;
      break;
    }
    case 2: {
      const symbol = '<span aria-hidden="true" style="display:inline-block;width:1em;height:8px;background:#000;vertical-align:middle;margin-right:6px;"></span>';
      trendButton.innerHTML = `${symbol} Staying the Same`;
      break;
    }
    case 3: {
      const arrow = '<span style="color:#F8312F">▲</span>';
      trendButton.innerHTML = `${arrow} Increasing`;
      break;
    }
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

  // Scroll-reveal animations
  const revealEls = document.querySelectorAll('.reveal');
  if (revealEls.length) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('reveal-in');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15 });
    revealEls.forEach((el) => io.observe(el));
  }

  // Back to top behavior
  const backToTopBtn = document.getElementById('backToTop');
  if (backToTopBtn) {
    const toggleBtn = () => {
      if (window.scrollY > 300) backToTopBtn.classList.add('show');
      else backToTopBtn.classList.remove('show');
    };
    toggleBtn();
    window.addEventListener('scroll', toggleBtn, { passive: true });
    backToTopBtn.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }
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
    let angleInDegrees = 0;
    // Set the needle angle based on activity level
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
    animation: {
      animateScale: true,
      animateRotate: true,
      duration: 900,
      easing: 'easeOutCubic'
    }
  },
  plugins: [gaugeNeedle],
};

const gaugeChart = new Chart(
  document.getElementById("doughnutChart"),
  gaugeConfig
);







